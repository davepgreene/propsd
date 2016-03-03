/* global Log, Config */
'use strict';

const EventEmitter = require('events').EventEmitter;
const async = require('async');
const StringTemplate = require('./string-template');
const Metadata = require('./source/metadata');
const S3 = require('./source/s3');

// const Consul = require('./source/consul');
// const File = require('./source/file');

const DEFAULT_CALLBACK_DELAY = 2000;

/**
 * Recursively iterate through an object applying the callback to each k/v pair
 * @param {Object} obj
 * @param {Function} callback
 * @returns {Object}
 */
function iter(obj, callback) {
  const collected = {};
  let value;

  for (const prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (typeof obj[prop] === 'object') {
        value = iter(obj[prop], callback);
      } else {
        value = callback(prop, obj[prop]);
      }
      collected[prop] = value;
    }
  }
  return collected;
}

class PluginManager extends EventEmitter {
  constructor(storage) {
    super();
    this.storage = storage;
    this.index = new S3({
      interval: Config.get('index:interval'),
      bucket: Config.get('index:bucket'),
      path: Config.get('index:path')
    });
    this.metadata = new Metadata();
    this._running = false;
    this._ok = true;
    this.updateDelay = DEFAULT_CALLBACK_DELAY;
    this._boundInit = this._init.bind(this);
  }

  /**
   * Initialize the PluginManager's index and metadata source
   */
  init() {
    Log.info('Initializing index and metadata');
    this._running = true;
    this._init();
  }

  /**
   * Shutdown the plugin manager's sources and then the plugin manager
   * @param {Boolean} del
   */
  shutdown(del) {
    Log.info('Shutting down sources');
    this.storage.sources.forEach((source) => {
      source.shutdown();
    });

    if (del === true) {
      this.storage.sources = [];
    }

    this._running = false;
  }

  /**
   * Get the plugin manager's status
   * @returns {{running: boolean, ok: boolean, sources: Array}}
   */
  status() {
    return {
      running: this._running,
      ok: this._ok,
      sources: this._sourcesStatus()
    };
  }

  /**
   * Gets an array of source statuses
   * @returns {Array}
   * @private
   */
  _sourcesStatus() {
    return this.storage.sources.map((source) => {
      return {
        name: source.name,
        type: source.type,
        status: source.status()
      };
    });
  }

  /**
   * Coordinates synchronizing the index and metadata sources and then mapping them together
   * @private
   */
  _init() {
    const boundIndex = this._index.bind(this);
    const boundMapper = this._mapper.bind(this);

    async.series([boundIndex, boundMapper], (err, response) => {
      // There's no possible error condition because both this._mapper() and this._index() handle
      // their own errors in order to retry their respective operations.
      this._ok = true;

      const sources = response[1];

      this.emit('sources-generated', sources);
      this._registerSources(sources);
      this.emit('sources-registered', this.storage.sources);
    });
  }

  /**
   * Coordinate fetching the PluginManager's index and metadata source
   * @param {Function} callback
   * @returns {null}
   * @private
   */
  _index(callback) {
    return async.parallel([
      this._createParallelTask(this.index),
      this._createParallelTask(this.metadata)
    ], (err) => {
      if (err) {
        // If any of the parallel tasks fail it means either the Metadata plugin or the index plugin has failed
        // so we need to determine which plugin threw the error then set a listener on it for its next update to
        // try to assemble the whole thing again.
        this._error(err);

        // ECONNREFUSED seems to be the only code that indicates an EC2MetadataService failure
        if (err.code === 'ECONNREFUSED') {
          this.metadata.shutdown();
          this.metadata.once('update', this._boundInit);
          this.metadata.initialize();
        } else {
          this.index.shutdown();
          this.index.once('update', this._boundInit);
          this.index.initialize();
        }
        return;
      }
      callback(null);
    });
  }

  /**
   * Maps instance metadata into the index document
   * @param {Function} callback
   * @private
   */
  _mapper(callback) {
    let sources = [];

    try {
      sources = this.index.properties.sources.map((el) => {
        return iter(el, (k, v) => {
          // TODO: No handling for arrays. Are we expecting arrays anywhere in the index?
          return StringTemplate.coerce(v, this.metadata.properties);
        });
      });
      callback(null, sources);
    } catch (mappingErr) {
      this._error(mappingErr);
      setTimeout(this._boundInit, this.updateDelay);
    }
  }

  /**
   * Create function that feeds async.parallel (or any async marshalling function)
   * @param {Metadata|S3} source
   * @returns {Function}
   * @private
   */
  _createParallelTask(source) {
    return (c) => {
      const callBackErr = (err) => {
        source.removeListener('update', callBackSuccess); // eslint-disable-line no-use-before-define
        c(err);
      };
      const callBackSuccess = () => {
        source.removeListener('error', callBackErr);
        c(null);
      };

      source.shutdown();
      source.once('update', callBackSuccess);
      source.once('error', callBackErr);
      source.initialize();
    };
  }

  /**
   * Register the sources with the storage layer and their event handlers
   * @param {Array} sources
   * @private
   */
  _registerSources(sources) {
    sources.forEach((source) => {
      let instance;

      switch (source.type.toLowerCase()) {
        case 's3':
          instance = new S3(Object.assign(source.parameters, {bucket: this.index.bucket}));
          break;

        // case 'file':
        //  //
        //  break;
        // case 'consul':
        //  //
        //  break;
        default:
          this._error(new Error(`Source type ${source.type} not implemented`));
      }
      this.emit('source-instantiated', instance);

      this.storage.register(instance);
      this._registerSourceEvents(instance);
      this.emit('source-registered', instance);

      instance.initialize();
      this.emit('source-initialized', instance);
    });

    this.index.once('update', () => {
      // TODO: Implement timeout so that someone spamming updates to the GH repo won't cause a constant rebuild
      setTimeout(() => {
        Log.info('There was an update to the index document.');
        this._boundInit();
      }, this.updateDelay);
    });
  }

  /**
   * Bind event handlers for each source.
   * @param {Metadata|S3} source
   * @private
   */
  _registerSourceEvents(source) {
    source.on('startup', () => {
      Log.info(`${source.name} started up.`);
    });

    source.on('shutdown', () => {
      Log.info(`${source.name} shut down.`);
    });

    source.on('update', () => {
      Log.info(`${source.name}'s data was updated from its underlying source data.`);
      setInterval(() => {
        this.storage.update();
      }, this.updateDelay);
    });

    source.on('no-update', () => {
      Log.info(`${source.name} has no update to its underlying source data.`);
    });

    source.on('error', (err) => {
      Log.info(`${source.name} encountered the following error: ${err}`);
      this._error(err);
    });
  }

  /**
   * General handler for all errors
   * @param {Error} err
   * @returns {PluginManager}
   * @private
   */
  _error(err) {
    Log.error(err, {
      source: this.name,
      type: this.type
    });

    this._ok = false;

    // Only emit an error event if there are listeners.
    if (this.listeners('error').length > 0) {
      this.emit('error', err);
    }

    return this;
  }
}

module.exports = PluginManager;

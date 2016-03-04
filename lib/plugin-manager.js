/* global Log, Config */
'use strict';

const EventEmitter = require('events').EventEmitter;
const StringTemplate = require('./string-template');
const Metadata = require('./source/metadata');
const S3 = require('./source/s3');

// TODO: Implement both of these source types
// const Consul = require('./source/consul');
// const File = require('./source/file');

const DEFAULT_INDEX_INTERVAL = Config.get('index:interval') || 60000; // eslint-disable-line rapid7/static-magic-numbers
const DEFAULT_INDEX_BUCKET = Config.get('index:bucket');
const DEFAULT_INDEX_PATH = Config.get('index:path');

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

class S3IndexParser {
  constructor() {
    this.properties = {};
  }

  update(data) {
    let properties = {};

    try {
      properties = JSON.parse(data.toString());
    } catch (e) {
      // We should have an error condition but tbd
    }
    this.properties = properties.sources;
  }
}

class PluginManager extends EventEmitter {
  /**
   * Creates a new instance of the PluginManager
   *
   * The following options are valid:
   * - interval (Number, default 60000) Interval for the index source timer
   * - bucket (String) The bucket where index data (and other configuration data) is stored
   * - path (String) The path to the index document in the bucket
   *
   * If a configuration document is provided when running the server, the options Object can be omitted
   * as the data will be filled from the global Config.
   *
   * @param {Storage} storage
   * @param {Object} options
   */
  constructor(storage, options) {
    super();

    const configuration = options || Object.create(null);

    this.storage = storage;

    this.index = new S3({
      interval: configuration.interval || DEFAULT_INDEX_INTERVAL,
      bucket: configuration.bucket || DEFAULT_INDEX_BUCKET,
      path: configuration.path || DEFAULT_INDEX_PATH,
      parser: new S3IndexParser()
    });
    this.index.on('error', (error) => {
      this._error(error);
    });
    this.index.on('update', () => {
      this._loadSourcesFromIndex();
    });

    this.metadata = new Metadata();
    this.metadata.service.host = configuration.metadataHost || Config.get('metadata:host');
    this.metadata.on('error', (error) => {
      this._error(error);
    });
    this.metadata.on('update', () => {
      this._loadSourcesFromIndex();
    });

    this._running = false;
    this._ok = true;
  }

  /**
   * Initialize the PluginManager's index and metadata source
   */
  initialize() {
    Log.info('Initializing index and metadata');
    this._running = true;
    this.index.initialize();
    this.metadata.initialize();
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
   * Called when either the S3 index or EC2 metadata are updated. If parsing of
   * of composite properties fails, an error is logged. Once parsing succeeds,
   * any additional sources in the index are registered.
   * @private
   */
  _loadSourcesFromIndex() {
    let sources = [];

    try {
      sources = this.index.properties.map((el) => {
        return iter(el, (k, v) => {
          // TODO: No handling for arrays. Are we expecting arrays anywhere in the index?
          return StringTemplate.coerce(v, this.metadata.properties);
        });
      });
    } catch (error) {
      this._error(error);
      return;
    }

    this._ok = true;
    this.emit('sources-generated', sources);
    this._registerSources(sources);
    this.emit('sources-registered', this.storage.sources);
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

          // TODO: Support for sources in other buckets
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

      if (instance) {
        this.emit('source-instantiated', instance);

        this.storage.register(instance);
        this._registerSourceEvents(instance);
        this.emit('source-registered', instance);

        instance.initialize();
        this.emit('source-initialized', instance);
      }
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
      this.storage.update();
    });

    source.on('no-update', () => {
      Log.info(`${source.name} has no update to its underlying source data.`);
    });

    source.on('error', (err) => {
      Log.error(`${source.name} encountered the following error: ${err}`);
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

/* eslint-env mocha */
/* global Config */
'use strict';

require('should');
const Path = require('path');
const fs = require('fs');
const winston = require('winston');

const server = require('./utils/test-metadata-server');

server.start();

global.Config = require('../lib/config').load(Path.resolve(__dirname, './data/config.json'));

global.Log = require('../lib/logger').attach(global.Config);
global.Log.remove(winston.transports.Console);

const Metadata = require('../lib/source/metadata');
const fakeMetadata = JSON.parse(fs.readFileSync(Path.resolve(__dirname, './data/test-metadata.json')));

const NON_DEFAULT_INTERVAL = 10000;

describe('Metadata source plugin', () => {
  beforeEach(() => {
    this.m = new Metadata();
    this.m.service.host = '127.0.0.1:8080';
  });

  afterEach(() => {
    this.m.shutdown();
  });

  it('creates a Metadata source instance with a non-default timer interval', () => {
    const m = new Metadata({
      interval: NON_DEFAULT_INTERVAL
    });

    m.interval.should.equal(NON_DEFAULT_INTERVAL);
  });

  it('initializes a timer with the set interval', (done) => {
    this.m.on('update', () => {
      const status = this.m.status();

      status.interval.should.have.keys(['_called', '_idleNext', '_idlePrev', '_idleStart', '_idleTimeout',
        '_onTimeout', '_repeat']);
      done();
    });

    this.m.initialize();
  });

  it('munges a set of paths to create a valid data object', (done) => {
    this.m.on('update', () => {
      const instance = this.m.properties.instance;
      const fake = fakeMetadata.latest['meta-data'];
      const creds = JSON.parse(fake.iam['security-credentials']['fake-role-name']);

      instance['ami-id'].should.equal(fake['ami-id']);
      instance.hostname.should.equal(fake.hostname);
      instance.identity.document.should.equal(fakeMetadata.latest.dynamic['instance-identity'].document);
      instance.credentials.lastUpdated.should.equal(creds.LastUpdated);

      done();
    });

    this.m.initialize();
  });

  it('shuts down cleanly', (done) => {
    this.m.on('shutdown', () => {
      const status = this.m.status();

      status.running.should.be.false();
      done();
    });

    this.m.initialize();
    this.m.shutdown();
  });

  it('can only be initialized once', () => {
    this.m.initialize();
    this.m.should.deepEqual(this.m.initialize());
  });

  it('doesn\'t update data if the Metadata Service document is the same', (done) => {
    let instanceId = null,
        signature = null,
        secondExecution = false;

    this.m.on('update', () => {
      instanceId = this.m.properties.instance['ami-id'];
      signature = this.m.signature;

      secondExecution = true;

      // This is a terrible hack
      this.m._timer = false;
      this.m.initialize();
    });

    this.m.on('no-update', () => {
      if (secondExecution) {
        this.m.properties.instance['ami-id'].should.equal(instanceId);
        this.m.signature.should.equal(signature);
        done();
      }
    });

    this.m.initialize();
  });

  it('exposes an error when one occurs but continues running', (done) => {
    server.stop();
    this.m.on('error', (err) => {
      const status = this.m.status();

      err.code.should.equal('ECONNREFUSED');
      status.ok.should.be.false();
      status.running.should.be.true();
      done();
    });

    this.m.initialize();
  });

  after(() => {
    server.start();
  });
});

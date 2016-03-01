/* eslint-env mocha */
'use strict';

const EventEmitter = require('events').EventEmitter;
const path = require('path');
const should = require('should');
const winston = require('winston');
const proxyquire = require('proxyquire');

global.Config = require('../lib/config').load(path.resolve(__dirname, './data/config.json'));
global.Log = require('../lib/logger').attach(global.Config);
global.Log.remove(winston.transports.Console);

class MockConsul {
  constructor() {
    // Mock the catalog.service.list function.
    this.catalog = {
      service: {
        list: 'catalog.service.list'
      }
    };

    // Mock the health.service function.
    this.health = {
      service: 'health.service'
    };

    // Track the mocked emitters.
    this.emitters = Object.create(null);
  }

  watch(options) {
    if (options.method === this.catalog.service.list) {
      return this.getOrCreateEmitter('catalog-service');
    }
    if (options.method === this.health.service) {
      return this.getOrCreateEmitter(options.options.tag || options.options.service);
    }
    throw new Error('Unknown method: ' + options.method);
  }

  emitChange(name, data) {
    this.emitters[name].emit('change', data);
  }

  getOrCreateEmitter(name) {
    if (!this.emitters[name]) {
      this.emitters[name] = new EventEmitter();
      this.emitters[name].end = () => {};
    }
    return this.emitters[name];
  }
}

function generateConsulStub() {
  const mock = new MockConsul();
  const Consul = proxyquire('../lib/source/consul', {
    consul() {
      return mock;
    }
  });
  const consul = new Consul();

  consul.mock = mock;
  return consul;
}

describe('Consul source plugin', () => {
  it('has a type', () => {
    const consul = generateConsulStub();

    should(consul.type).eql('consul');
  });

  it('reports as running after startup', (done) => {
    const consul = generateConsulStub();

    consul.on('startup', () => {
      should(consul.status().running).eql(true);
      done();
    });

    should(consul.status().running).eql(false);
    consul.initialize();
  });

  it('reports as not running after shutdown', (done) => {
    const consul = generateConsulStub();

    consul.on('shutdown', () => {
      should(consul.status().running).eql(false);
      done();
    });

    consul.initialize();
    should(consul.status().running).eql(true);
    consul.shutdown();
  });

  it('emits an update event when properites change', (done) => {
    const consul = generateConsulStub();

    consul.on('update', (properties) => {
      should(properties).eql({consul: {addresses: []}});
      done();
    });

    consul.initialize();
    consul.mock.emitChange('catalog-service', {consul: []});
    consul.mock.emitChange('consul', {});
  });
});

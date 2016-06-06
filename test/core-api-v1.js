/* eslint-env mocha */
'use strict';

const request = require('supertest');
const Properties = require('../lib/properties');
const Sources = require('../lib/sources');
const S3 = require('../lib/source/s3');

require('should');

const testServerPort = 3000;
const HTTP_OK = 200;
const HTTP_METHOD_NOT_ALLOWED = 405;

const sourceStatus = () => {
  return {
    ok: true,
    updated: 1,
    interval: 60000, // eslint-disable-line rapid7/static-magic-numbers
    running: true
  };
};

const storage = {
  sources: [{
    name: 'foo-bar-baz.json',
    type: 's3',
    status: sourceStatus
  }, {
    name: 'foo-quiz-buzz.json',
    type: 's3',
    status: sourceStatus
  }]
};

const pluginManager = {
  index: {
    status: sourceStatus
  },
  metadata: {
    status: sourceStatus
  }
};

const endpoints = {
  health: '/v1/health',
  status: '/v1/status'
};

const expectedStatusResponse = {
  status: HTTP_OK,
  index: {
    ok: true,
    updated: 1,
    interval: 60000, // eslint-disable-line rapid7/static-magic-numbers
    running: true
  },
  sources: [{
    name: 'foo-bar-baz.json',
    type: 's3',
    status: 'okay'
  }, {
    name: 'foo-quiz-buzz.json',
    type: 's3',
    status: 'okay'
  }]
};

const properties = new Properties();

properties.dynamic(new S3('foo-bar-baz.json', {
  bucket: 'test-bucket',
  path: 'foo-bar-baz.json'
}), 'test');

properties.dynamic(new S3('foo-quiz-buzz.json', {
  bucket: 'test-bucket',
  path: 'foo-quiz-buzz.json'
}), 'test');

const sources = new Sources(properties);


/**
 * Create a new Express server for testing
 *
 * @return {http.Server}
 */
const makeServer = () => {
  const app = require('express')();

  require('../lib/control/v1/core').attach(app, sources);
  return app.listen(testServerPort);
};

describe('Core API v1', () => {
  let server = null;

  beforeEach(() => {
    server = makeServer();
  });

  afterEach((done) => {
    server.close(done);
  });

  for (const endpoint in endpoints) {
    if (!endpoints.hasOwnProperty(endpoint)) {
      continue;
    }

    /* eslint-disable no-loop-func */
    it(`acknowledges GET requests to the ${endpoint} endpoint`, (done) => {
      request(server)
        .get(endpoints[endpoint])
        .set('Accept', 'application/json')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(HTTP_OK)
        .end(done);
    });

    it(`rejects all other request types to the ${endpoint} endpoint`, (done) => {
      request(server)
        .delete(endpoints[endpoint])
        .expect('Allow', 'GET')
        .expect(HTTP_METHOD_NOT_ALLOWED);

      request(server)
        .put(endpoints[endpoint])
        .expect('Allow', 'GET')
        .expect(HTTP_METHOD_NOT_ALLOWED);

      request(server)
        .post(endpoints[endpoint])
        .expect('Allow', 'GET')
        .expect(HTTP_METHOD_NOT_ALLOWED)
        .end(done);
    });

    /* eslint-enable no-loop-func */
  }

  it('responds correctly to a request to the /status endpoint', (done) => {
    request(server)
      .get(endpoints.status)
      .set('Accept', 'application/json')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(HTTP_OK)
      .end((err, res) => {
        res.body.should.have.properties(expectedStatusResponse);
        res.body.should.have.property('uptime');
        done();
      });
  });

  it('responds correctly to a request to the /health endpoint', (done) => {
    request(server)
      .get(endpoints.health)
      .set('Accept', 'application/json')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(HTTP_OK)
      .end((err, res) => {
        res.body.should.have.properties({status: HTTP_OK, plugins: {s3: expectedStatusResponse.sources.length}});
        res.body.should.have.property('uptime');
        res.body.should.have.property('version');
        done();
      });
  });

  it('returns a 500 if any source plugins fail');

  it('returns a 429 if any source plugins have a warning');
});

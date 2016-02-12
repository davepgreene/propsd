'use strict';

const HTTP_OK = 200;
const HTTP_METHOD_NOT_ALLOWED = 405;

/**
 * Conqueso compatible API
 *
 * @param {Express.App} app
 */
function Conqueso(app) {
  app.post('/v1/conqueso*', (req, res) => {
    res.status(HTTP_OK).end();
  });

  app.put('/v1/conqueso*', (req, res) => {
    res.status(HTTP_OK).end();
  });

  app.delete('/v1/conqueso*', (req, res) => {
    res.set('Allow', 'POST,PUT');
    res.status(HTTP_METHOD_NOT_ALLOWED);
    res.end();
  });
}

exports.attach = Conqueso;

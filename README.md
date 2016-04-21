# Propsd
[![Build Status][travis-image]][travis-url] [![Coverage Status][coveralls-image]][coveralls-url]

Propsd does dynamic property management at scale, across thousands of servers
and changes from hundreds of developers.

We built propsd with lessons learned from years of running [Conqueso][] on
large scale systems. High availability is achieved by leveraging [Amazon S3][]
to deliver properties and [Consul][] to handle service discovery. Composable
layering lets you set properties for an organization, a single server, and
everything in between. Plus, flat file storage makes backups and audits
a breeze.

So if your [Conqueso][] server's starting to heat up or you just want an audit
trail when things change, give propsd a try.

## Getting Started

See the [getting started guide][gsg] for help installing, configuring, and
using propsd.

## Usage

The Propsd server runs under [Node.js][]. Run the following command to start it.

~~~bash
node bin/server.js
~~~

This will start the [HTTP server][http-api] listening on port 127.0.0.1:9100.
If you need to specify different server options, see the [getting started
guide][gsg]. Inline help is available with the `--help` argument.

~~~bash
node bin/server.js --help
~~~

### Development

To run Propsd locally without dependencies on the AWS Instance Metadata Service or AWS S3, you can run local test versions of both. Currently these services are only tested on OS X.

The services listed below are wrapped up in an npm task which allows you to get up and running quickly. Simply clone the repository, run `npm install` and run `npm run dev-server`. That's it!

#### Metadata Service

To run the test metadata server:
~~~bash
npm run metadata-server
~~~

The server will listen on `http://127.0.0.1:8080`. It can be used in the same way that you would use the AWS Instance Metadata Service (e.g. `curl http://127.0.0.1:8080/latest/meta-data/ami-id`). To specify the metadata service host and port that Propsd will use modify the config file:
~~~json
{
  ...
  "metadata": {
    "host": "127.0.0.1:8080"
  }
  ...
}
~~~

#### S3 Server
To run the test S3 server:
~~~bash
npm run s3-server -- -d <data directory>
~~~
The `-d` or `--data` argument is required. If you need to specify different server options you can view the S3 server help by running `npm run s3-server -- --help`.

Sample data ships with the Propsd project for the test suite to use but the same data can be served from the test server as well. Run the following command to start with test data:
~~~bash
npm run s3-server -- -d test/data/s3
~~~
This will start the test server and serve S3 objects from the `test/data/s3` directory. Because of some peculiarities in the library being used for the server, you cannot live-edit the test data. Instead, you must shut down the server, edit the data, then restart it.

The bucket the objects are served from is `propsd-<final directory in path>` and the endpoint is the server IP address. So, for example, if you use the provided test data, the relevant section of the config file would be:
~~~json
{
  ...
  "index": {
    "endpoint": "http://127.0.0.1:4569",
     "path": "index.json",
     "interval": 30000
  }
  ...
}
~~~

If an `endpoint` key is provided, the S3 source and it's underlying client will assume that you are serving data from another location and will ignore the `region` key, if provided.

## Releasing
To cut a release do the following:
* [Bump the version][npm-version]
* Build and upload a package
* Create a new release on github.com

This can be accomplished by running the following commands:
~~~bash
npm version minor
rake
~~~
Then following the steps to create the release on github.com


[Node.js]: https://nodejs.org/en/
[http-api]: docs/http-api.md
[travis-image]: https://travis-ci.org/rapid7/propsd.svg?branch=master
[travis-url]: https://travis-ci.org/rapid7/propsd
[coveralls-image]: https://coveralls.io/repos/rapid7/propsd/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/rapid7/propsd?branch=master
[npm-version]: https://docs.npmjs.com/cli/version
[Conqueso]: https://github.com/rapid7/conqueso
[Consul]: https://www.consul.io/
[Amazon S3]: https://aws.amazon.com/s3/
[gsg]: ./docs/getting-started/

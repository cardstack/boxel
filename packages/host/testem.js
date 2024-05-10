'use strict';

const MultiReporter = require('testem-multi-reporter');
const TapReporter = require('testem/lib/reporters/tap_reporter');
const XunitReporter = require('testem/lib/reporters/xunit_reporter');
const fs = require('fs');

const config = {
  test_page: 'tests/index.html?hidepassed',
  disable_watching: true,
  launch_in_ci: [process.env.TESTEM_BROWSER || 'Chrome'],
  launch_in_dev: ['Chrome'],
  browser_start_timeout: 120,
  browser_args: {
    Chrome: {
      ci: [
        // --no-sandbox is needed when running Chrome inside a container
        process.env.CI ? '--no-sandbox' : null,
        '--headless',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--mute-audio',
        '--remote-debugging-port=0',
        '--window-size=1440,900',
      ].filter(Boolean),
    },
    Firefox: ['--headless', '--width=1440', '--height=900'],
  },
};

if (process.env.CI) {
  fs.mkdirSync('../../junit');

  const reporters = [
    {
      ReporterClass: TapReporter,
      args: [false, null, { get: () => false }],
    },
    {
      ReporterClass: XunitReporter,
      args: [
        false,
        fs.createWriteStream('../../junit/host.xml'),
        { get: () => false },
      ],
    },
  ];

  const multiReporter = new MultiReporter({ reporters });

  config.reporter = multiReporter;
}

module.exports = config;

/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const request = require('request-promise-native');
const { error, log } = require('@adobe/helix-log');

const frequency = 15;
const status = 'ENABLED';
const slaThreshold = 7;
const locations = [
  'AWS_AP_NORTHEAST_1',
  'AWS_AP_SOUTHEAST_2',
  'AWS_EU_CENTRAL_1',
  'AWS_EU_WEST_2',
  'AWS_SA_EAST_1',
  'AWS_US_EAST_1',
  'AWS_US_WEST_1',
];

let packageName;

try {
  packageName = JSON.parse(fs.readFileSync('package.json')).name;
} catch (e) {
  packageName = undefined;
}


async function getmonitors(auth, monitorid, monitorname) {
  try {
    let more = true;
    const loadedmonitors = [];
    while (more) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request.get(`https://synthetics.newrelic.com/synthetics/api/v3/monitors?limit=100&offset=${loadedmonitors.length}`, {
        headers: {
          'X-Api-Key': auth,
        },
        json: true,
      });
      if (response.count < 10) {
        more = false;
      }
      loadedmonitors.push(...response.monitors);
    }

    const monitors = loadedmonitors.map(({ id, name }) => ({ id, name }));
    if (monitorid) {
      return monitors.filter((monitor) => monitor.id === monitorid);
    }
    if (monitorname) {
      return monitors.filter((monitor) => monitor.name === monitorname);
    } else {
      return [];
    }
  } catch (e) {
    error('Unable to retrieve monitors');
    return [];
  }
}

async function updatescript(auth, monitor, url) {
  log('Updating the script for monitor', monitor.name);


  const scriptText = Buffer.from(fs
    .readFileSync(path.resolve(__dirname, 'synthetics.js'))
    .toString()
    .replace('$$$URL$$$', url))
    .toString('base64');

  await request.put(`https://synthetics.newrelic.com/synthetics/api/v3/monitors/${monitor.id}/script`, {
    json: true,
    headers: {
      'X-Api-Key': auth,
    },
    body: {
      scriptText,
    },
  });
  log('done.');
}

async function createorupdate({
  auth, name, id, url,
}) {
  const [monitor] = await getmonitors(auth, id, name);

  if (monitor) {
    // update
    await updatescript(auth, monitor, url);
  } else {
    // create
    log('Creating a new monitor', name);
    try {
      await request.post('https://synthetics.newrelic.com/synthetics/api/v3/monitors', {
        json: true,
        headers: {
          'X-Api-Key': auth,
        },
        body: {
          name,
          type: 'SCRIPT_API',
          frequency,
          locations,
          status,
          slaThreshold,
        },
      });
      await createorupdate({
        auth, name, id, url,
      });
    } catch (e) {
      error('Monitor creation failed', e.message);
      process.exit(1);
    }
  }
}

function baseargs(y) {
  return y
    .positional('url', {
      type: 'string',
      required: true,
      describe: 'the URL to check',
    })
    .option('auth', {
      type: 'string',
      describe: 'your New Relics API Key (alternatively use $NEWRELICS_AUTH env var)',
      required: true,
    });
}

function run() {
  return yargs
    .scriptName('synthetics-check')
    .usage('$0 <cmd> url')
    .command('create url', 'Create a new check', (y) => baseargs(y)
      .option('name', {
        type: 'string',
        describe: 'the name of the check',
        required: packageName === undefined,
        default: packageName,
      }), createorupdate)
    .command('update url', 'Create or update an existing check', (y) => baseargs(y)
      .option('id', {
        type: 'string',
        describe: 'The ID of the check to update',
      })
      .option('name', {
        type: 'string',
        describe: 'the name of the check',
        default: packageName,
      }), createorupdate)
    .help()
    .strict()
    .demandCommand(1)
    .env('NEWRELIC')
    .argv;
}

run();

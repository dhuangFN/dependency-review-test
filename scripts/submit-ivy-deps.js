#!/usr/bin/env node

const fs = require('fs');
const https = require('https');

const manifestPath = process.argv[2] || 'ivy.xml';
const token = process.env.GITHUB_TOKEN || process.env.GITHUB_AUTH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF;

if (!token) {
  console.error('Missing GITHUB_TOKEN for dependency submission.');
  process.exit(1);
}
if (!repo || !sha || !ref) {
  console.error('Missing required GitHub environment variables.');
  process.exit(1);
}

const ivyXml = fs.readFileSync(manifestPath, 'utf8');
const depRegex = /<dependency\s+[^>]*org="([^"]+)"[^>]*name="([^"]+)"[^>]*rev="([^"]+)"[^>]*\/?\s*>/g;

const resolved = {};
let match;
while ((match = depRegex.exec(ivyXml)) !== null) {
  const org = match[1];
  const name = match[2];
  const rev = match[3];
  const purl = `pkg:maven/${org}/${name}@${rev}`;
  resolved[purl] = {
    package_url: purl,
    relationship: 'direct',
    scope: 'runtime',
    dependencies: []
  };
}

if (Object.keys(resolved).length === 0) {
  console.error(`No dependencies found in ${manifestPath}.`);
  process.exit(1);
}

const payload = {
  version: 0,
  sha,
  ref,
  scanned: new Date().toISOString(),
  job: {
    id: process.env.GITHUB_JOB || 'ivy-dependency-submission',
    correlator: `${process.env.GITHUB_WORKFLOW || 'ivy-workflow'}:${process.env.GITHUB_JOB || 'ivy-dependency-submission'}`
  },
  detector: {
    name: 'ivy-manifest-parser',
    version: '0.1.0',
    url: 'https://github.com/actions/dependency-review-action'
  },
  manifests: {
    [manifestPath]: {
      name: 'ivy',
      file: {
        source_location: manifestPath
      },
      resolved
    }
  }
};

const [owner, repoName] = repo.split('/');
const requestBody = JSON.stringify(payload);

const req = https.request(
  {
    method: 'POST',
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repoName}/dependency-graph/snapshots`,
    headers: {
      'User-Agent': 'ivy-dependency-submission',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody)
    }
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Dependency snapshot submitted.');
      } else {
        console.error(`Dependency submission failed: ${res.statusCode}`);
        console.error(data);
        process.exit(1);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('Dependency submission error:', err.message);
  process.exit(1);
});

req.write(requestBody);
req.end();

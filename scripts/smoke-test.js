#!/usr/bin/env node
// @ts-check

/**
 * Smoke test script for UPSCat production routes.
 * Uses Node.js native fetch (Node 18+). No external dependencies.
 *
 * Usage:
 *   BASE_URL=https://upscat.click node scripts/smoke-test.js
 *
 * Defaults to http://localhost:3000 if BASE_URL is not set.
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const PUBLIC_ROUTES = [
  '/',
  '/browse',
  '/gs1',
  '/gs2',
  '/gs3',
  '/gs4',
  '/essay',
  '/optional/anthropology',
  '/optional/geography',
  '/optional/history',
  '/optional/psir',
  '/optional/public-administration',
  '/optional/sociology',
];

/**
 * @typedef {{ route: string, method: string, expected: number, actual: number | string, pass: boolean }} TestResult
 */

/**
 * Makes a fetch request with a 5-second timeout.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Test all public routes return HTTP 200.
 * @returns {Promise<TestResult[]>}
 */
async function testPublicRoutes() {
  /** @type {TestResult[]} */
  const results = [];
  for (const route of PUBLIC_ROUTES) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}${route}`);
      results.push({
        route,
        method: 'GET',
        expected: 200,
        actual: res.status,
        pass: res.status === 200,
      });
    } catch (err) {
      results.push({
        route,
        method: 'GET',
        expected: 200,
        actual: err instanceof Error ? err.message : 'ERROR',
        pass: false,
      });
    }
  }
  return results;
}

/**
 * Test POST /api/answer-source with a foreign Origin returns 403.
 * @returns {Promise<TestResult>}
 */
async function testAnswerSourceCORS() {
  const route = '/api/answer-source';
  try {
    const res = await fetchWithTimeout(`${BASE_URL}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.com',
      },
      body: JSON.stringify({ answerId: 'test' }),
    });
    return {
      route,
      method: 'POST',
      expected: 403,
      actual: res.status,
      pass: res.status === 403,
    };
  } catch (err) {
    return {
      route,
      method: 'POST',
      expected: 403,
      actual: err instanceof Error ? err.message : 'ERROR',
      pass: false,
    };
  }
}

/**
 * Test GET /api/search?q=test returns 200.
 * @returns {Promise<TestResult>}
 */
async function testSearchAPI() {
  const route = '/api/search?q=test';
  try {
    const res = await fetchWithTimeout(`${BASE_URL}${route}`);
    return {
      route,
      method: 'GET',
      expected: 200,
      actual: res.status,
      pass: res.status === 200,
    };
  } catch (err) {
    return {
      route,
      method: 'GET',
      expected: 200,
      actual: err instanceof Error ? err.message : 'ERROR',
      pass: false,
    };
  }
}

/**
 * Test /pdf/test-answer-id returns a page (not a redirect).
 * Uses redirect: 'manual' to catch 301/302.
 * @returns {Promise<TestResult>}
 */
async function testPDFRoute() {
  const route = '/pdf/test-answer-id';
  try {
    const res = await fetchWithTimeout(`${BASE_URL}${route}`, {
      redirect: 'manual',
    });
    // We expect a page response (200, 400, 404 are all acceptable — NOT 301/302)
    const isRedirect = res.status === 301 || res.status === 302;
    return {
      route,
      method: 'GET',
      expected: 200,
      actual: res.status,
      pass: !isRedirect,
    };
  } catch (err) {
    return {
      route,
      method: 'GET',
      expected: 200,
      actual: err instanceof Error ? err.message : 'ERROR',
      pass: false,
    };
  }
}

/**
 * Print results as a formatted table.
 * @param {TestResult[]} results
 */
function printResults(results) {
  const routeWidth = Math.max(6, ...results.map((r) => r.route.length));
  const methodWidth = 6;
  const expectedWidth = 8;
  const actualWidth = Math.max(6, ...results.map((r) => String(r.actual).length));
  const statusWidth = 6;

  const header = [
    'Route'.padEnd(routeWidth),
    'Method'.padEnd(methodWidth),
    'Expected'.padEnd(expectedWidth),
    'Actual'.padEnd(actualWidth),
    'Status'.padEnd(statusWidth),
  ].join(' | ');

  const separator = [
    '-'.repeat(routeWidth),
    '-'.repeat(methodWidth),
    '-'.repeat(expectedWidth),
    '-'.repeat(actualWidth),
    '-'.repeat(statusWidth),
  ].join('-+-');

  console.log('');
  console.log(header);
  console.log(separator);

  for (const r of results) {
    const status = r.pass ? '✓ PASS' : '✗ FAIL';
    const row = [
      r.route.padEnd(routeWidth),
      r.method.padEnd(methodWidth),
      String(r.expected).padEnd(expectedWidth),
      String(r.actual).padEnd(actualWidth),
      status.padEnd(statusWidth),
    ].join(' | ');
    console.log(row);
  }
  console.log('');
}

async function main() {
  console.log(`\nSmoke testing: ${BASE_URL}\n`);

  const results = [];

  // Public routes
  const publicResults = await testPublicRoutes();
  results.push(...publicResults);

  // API: answer-source CORS
  results.push(await testAnswerSourceCORS());

  // API: search
  results.push(await testSearchAPI());

  // PDF route (no redirect)
  results.push(await testPDFRoute());

  printResults(results);

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`❌ ${failures.length} test(s) failed.\n`);
    process.exit(1);
  } else {
    console.log(`✅ All ${results.length} tests passed.\n`);
    process.exit(0);
  }
}

main();

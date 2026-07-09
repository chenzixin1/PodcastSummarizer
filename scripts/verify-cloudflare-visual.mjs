import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const prodBase = (process.env.PROD_BASE_URL || 'https://podsum.cc').replace(/\/+$/, '');
const previewBase = (process.env.CF_PREVIEW_BASE_URL || 'https://cf-preview.podsum.cc').replace(/\/+$/, '');
const outputDir = process.env.VISUAL_OUTPUT_DIR || path.join(process.cwd(), 'output', 'playwright', 'cloudflare-preview-visual');
const maxMismatchRatio = Number(process.env.VISUAL_MAX_MISMATCH_RATIO || '0.03');
const allowExploreSmoke = process.env.VISUAL_ALLOW_EXPLORE_SMOKE === '1';

const routes = (process.env.VISUAL_ROUTES || '/,/?view=explore,/about,/auth/signin,/chrome-extension')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

const exploreSmokeRoute = '/?view=explore';
const exploreSmokeCues = [
  'What is a Forward Deployed Engineer?',
  'Jensen Huang',
];

const ignoredConsoleErrorPatterns = [
  /Permissions policy violation: compute-pressure is not allowed in this document\./i,
];

function slug(input) {
  return input === '/' ? 'home' : input.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function shouldIgnoreConsoleError(text) {
  return ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text));
}

function getSmokeResult(route, previewCapture) {
  if (!allowExploreSmoke || route !== exploreSmokeRoute) {
    return {
      routeSmokeMode: null,
      previewSmokeChecks: null,
      passed: null,
    };
  }

  const previewText = previewCapture.snapshot.text || '';
  const previewTitle = previewCapture.snapshot.title || '';
  const previewHasRuntimeErrors =
    previewCapture.consoleErrors.length > 0 ||
    previewCapture.pageErrors.length > 0 ||
    previewCapture.httpErrors.length > 0;
  const matchingCue = exploreSmokeCues.find((cue) => previewText.includes(cue)) || null;
  const previewSmokeChecks = {
    runtimeErrorsClear: !previewHasRuntimeErrors,
    containsExplore: previewText.includes('Explore'),
    containsKnownCue: matchingCue !== null,
    matchingCue,
    titleIsNot404: !/404/i.test(previewTitle),
    textDoesNotContainNotFound: !previewText.includes('This page could not be found'),
  };

  return {
    routeSmokeMode: 'explore-preview-smoke',
    previewSmokeChecks,
    passed: Object.values(previewSmokeChecks).every((value) => value !== false),
  };
}

async function capture(page, baseUrl, route, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const sameOrigin = new URL(baseUrl).origin;

  const onConsole = (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!shouldIgnoreConsoleError(text)) {
        consoleErrors.push(text);
      }
    }
  };
  const onPageError = (error) => {
    pageErrors.push(error.message);
  };
  const onResponse = (response) => {
    const responseUrl = response.url();
    if (response.status() >= 400 && responseUrl.startsWith(sameOrigin)) {
      httpErrors.push(`${response.status()} ${responseUrl}`);
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 12000 }).catch(() => null);
    await page.waitForFunction(() => {
      const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
      if (!text) {
        return false;
      }
      return !/Loading (summaries|transcript data|content)/i.test(text);
    }, null, { timeout: 15000 }).catch(() => null);
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(750);
    const snapshot = await page.evaluate(() => {
      const rectFor = (selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const rectsFor = (selector) =>
        Array.from(document.querySelectorAll(selector)).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });

      return {
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        body: rectFor('body'),
        header: rectFor('header'),
        main: rectFor('main'),
        footer: rectFor('footer'),
        h1: rectFor('h1'),
        iframes: rectsFor('iframe'),
      };
    });
    return {
      screenshot: await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        mask: [page.locator('iframe')],
        maskColor: '#141814',
      }),
      snapshot,
      consoleErrors,
      pageErrors,
      httpErrors,
    };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

async function decodePng(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const raw = await image.ensureAlpha().raw().toBuffer();
  return {
    width: metadata.width,
    height: metadata.height,
    raw,
  };
}

function compareRawImages(prod, preview) {
  if (prod.width !== preview.width || prod.height !== preview.height) {
    return {
      sameDimensions: false,
      mismatchPixels: Number.POSITIVE_INFINITY,
      mismatchRatio: 1,
      totalPixels: Math.max(prod.width * prod.height, preview.width * preview.height),
    };
  }

  let mismatchPixels = 0;
  const totalPixels = prod.width * prod.height;
  for (let i = 0; i < prod.raw.length; i += 4) {
    const dr = Math.abs(prod.raw[i] - preview.raw[i]);
    const dg = Math.abs(prod.raw[i + 1] - preview.raw[i + 1]);
    const db = Math.abs(prod.raw[i + 2] - preview.raw[i + 2]);
    const da = Math.abs(prod.raw[i + 3] - preview.raw[i + 3]);
    if (dr + dg + db + da > 4) {
      mismatchPixels += 1;
    }
  }

  return {
    sameDimensions: true,
    mismatchPixels,
    mismatchRatio: mismatchPixels / totalPixels,
    totalPixels,
  };
}

async function writeDiffImage(prod, preview, outputPath) {
  if (prod.width !== preview.width || prod.height !== preview.height) {
    return null;
  }

  const diff = Buffer.alloc(prod.raw.length);
  for (let i = 0; i < prod.raw.length; i += 4) {
    const dr = Math.abs(prod.raw[i] - preview.raw[i]);
    const dg = Math.abs(prod.raw[i + 1] - preview.raw[i + 1]);
    const db = Math.abs(prod.raw[i + 2] - preview.raw[i + 2]);
    const delta = dr + dg + db + Math.abs(prod.raw[i + 3] - preview.raw[i + 3]);
    if (delta > 4) {
      diff[i] = 255;
      diff[i + 1] = 0;
      diff[i + 2] = 80;
      diff[i + 3] = 255;
    } else {
      diff[i] = Math.round(prod.raw[i] * 0.25 + 245 * 0.75);
      diff[i + 1] = Math.round(prod.raw[i + 1] * 0.25 + 245 * 0.75);
      diff[i + 2] = Math.round(prod.raw[i + 2] * 0.25 + 245 * 0.75);
      diff[i + 3] = 255;
    }
  }

  await sharp(diff, {
    raw: {
      width: prod.width,
      height: prod.height,
      channels: 4,
    },
  }).png().toFile(outputPath);
  return outputPath;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const prodPage = await context.newPage();
  const previewPage = await context.newPage();
  const report = [];

  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        const caseName = `${slug(route)}-${viewport.name}`;
        const [prodCapture, previewCapture] = await Promise.all([
          capture(prodPage, prodBase, route, viewport),
          capture(previewPage, previewBase, route, viewport),
        ]);

        const prodPath = path.join(outputDir, `${caseName}-prod.png`);
        const previewPath = path.join(outputDir, `${caseName}-preview.png`);
        await Promise.all([
          fs.writeFile(prodPath, prodCapture.screenshot),
          fs.writeFile(previewPath, previewCapture.screenshot),
        ]);

        const prodDecoded = await decodePng(prodCapture.screenshot);
        const previewDecoded = await decodePng(previewCapture.screenshot);
        const comparison = compareRawImages(prodDecoded, previewDecoded);
        const textMatches = prodCapture.snapshot.text === previewCapture.snapshot.text;
        const titleMatches = prodCapture.snapshot.title === previewCapture.snapshot.title;
        const layoutMatches = JSON.stringify({
          scrollWidth: prodCapture.snapshot.scrollWidth,
          scrollHeight: prodCapture.snapshot.scrollHeight,
          body: prodCapture.snapshot.body,
          header: prodCapture.snapshot.header,
          main: prodCapture.snapshot.main,
          footer: prodCapture.snapshot.footer,
          h1: prodCapture.snapshot.h1,
          iframes: prodCapture.snapshot.iframes,
        }) === JSON.stringify({
          scrollWidth: previewCapture.snapshot.scrollWidth,
          scrollHeight: previewCapture.snapshot.scrollHeight,
          body: previewCapture.snapshot.body,
          header: previewCapture.snapshot.header,
          main: previewCapture.snapshot.main,
          footer: previewCapture.snapshot.footer,
          h1: previewCapture.snapshot.h1,
          iframes: previewCapture.snapshot.iframes,
        });
        const previewHasRuntimeErrors =
          previewCapture.consoleErrors.length > 0 ||
          previewCapture.pageErrors.length > 0 ||
          previewCapture.httpErrors.length > 0;
        const smokeResult = getSmokeResult(route, previewCapture);
        const routeSmokeMode = smokeResult.routeSmokeMode;
        const previewSmokeChecks = smokeResult.previewSmokeChecks;
        const defaultPassed =
          textMatches &&
          titleMatches &&
          layoutMatches &&
          comparison.sameDimensions &&
          comparison.mismatchRatio <= maxMismatchRatio &&
          !previewHasRuntimeErrors;
        const passed = smokeResult.passed ?? defaultPassed;
        const diffPath = path.join(outputDir, `${caseName}-diff.png`);
        if (!passed) {
          await writeDiffImage(prodDecoded, previewDecoded, diffPath);
        }
        const row = {
          route,
          viewport,
          passed,
          prodPath,
          previewPath,
          diffPath: passed ? null : diffPath,
          textMatches,
          titleMatches,
          layoutMatches,
          prodConsoleErrors: prodCapture.consoleErrors,
          previewConsoleErrors: previewCapture.consoleErrors,
          prodPageErrors: prodCapture.pageErrors,
          previewPageErrors: previewCapture.pageErrors,
          prodHttpErrors: prodCapture.httpErrors,
          previewHttpErrors: previewCapture.httpErrors,
          previewHasRuntimeErrors,
          routeSmokeMode,
          previewSmokeChecks,
          prodSnapshot: prodCapture.snapshot,
          previewSnapshot: previewCapture.snapshot,
          ...comparison,
        };
        report.push(row);

        const marker = passed ? 'PASS' : 'FAIL';
        console.log(
          `${marker} ${route} ${viewport.name} smokeMode=${routeSmokeMode || 'none'} runtimeErrors=${previewHasRuntimeErrors} text=${textMatches} layout=${layoutMatches} mismatchRatio=${comparison.mismatchRatio.toFixed(6)} mismatchPixels=${comparison.mismatchPixels}/${comparison.totalPixels}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify({
    prodBase,
    previewBase,
    maxMismatchRatio,
    generatedAt: new Date().toISOString(),
    results: report,
  }, null, 2));
  console.log(`Report: ${reportPath}`);

  const failed = report.filter((row) => !row.passed);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

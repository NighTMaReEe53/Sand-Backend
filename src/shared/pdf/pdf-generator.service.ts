import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

/**
 * HTML → PDF renderer built on Puppeteer.
 *
 * A real browser engine gives us:
 *  - Perfect Arabic text shaping + bidi (no more reversed/broken letters)
 *  - Full CSS control so reports can be beautifully designed
 *  - Embedded custom fonts (Amiri) via data URIs, no network dependency
 */
@Injectable()
export class PdfGeneratorService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfGeneratorService.name);
  private browserPromise: Promise<puppeteer.Browser> | null = null;
  private fontCache = new Map<string, string>();

  /** Returns an @font-face block embedding a local .ttf as a base64 data URI. */
  getEmbeddedFontFace(family: string, fileName: string): string {
    const key = `${family}:${fileName}`;
    if (!this.fontCache.has(key)) {
      const fontPath = path.join(process.cwd(), 'assets', 'fonts', fileName);
      let src = '';
      try {
        src = `data:font/ttf;base64,${fs.readFileSync(fontPath).toString('base64')}`;
      } catch {
        this.logger.warn(`Font not found at ${fontPath} — falling back to system fonts.`);
      }
      this.fontCache.set(key, src);
    }
    const dataUri = this.fontCache.get(key)!;
    if (!dataUri) return '';
    return `
      @font-face {
        font-family: '${family}';
        src: url('${dataUri}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    `;
  }

  /** Renders a full HTML document into an A4 PDF buffer. */
  async htmlToPdf(
    html: string,
    options: {
      format?: puppeteer.PaperFormat;
      margin?: { top?: string; right?: string; bottom?: string; left?: string };
      headerHtml?: string;
      footerHtml?: string;
    } = {},
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: 60_000,
      });
      // Ensure embedded Arabic font is fully loaded before printing.
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        format: options.format ?? 'A4',
        printBackground: true,
        displayHeaderFooter: Boolean(options.headerHtml || options.footerHtml),
        headerTemplate: options.headerHtml ?? '<span></span>',
        footerTemplate: options.footerHtml ?? '<span></span>',
        margin: {
          top: options.margin?.top ?? '14mm',
          right: options.margin?.right ?? '12mm',
          bottom: options.margin?.bottom ?? '14mm',
          left: options.margin?.left ?? '12mm',
        },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private getBrowser(): Promise<puppeteer.Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--font-render-hinting=none',
          ],
        })
        .catch((err) => {
          // Allow a retry on next call instead of caching a failed launch.
          this.browserPromise = null;
          throw err;
        });
    }
    return this.browserPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise.catch(() => null);
      await browser?.close().catch(() => undefined);
      this.browserPromise = null;
    }
  }
}

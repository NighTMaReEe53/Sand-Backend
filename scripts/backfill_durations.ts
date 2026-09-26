/**
 * One-time backfill: recompute lesson durations from the actual video files
 * using ffprobe and update the stored durationSeconds in the database.
 *
 * Usage (run from the Backend folder):
 *   Dry-run (no writes):  npx ts-node scripts/backfill_durations.ts
 *   Apply changes:        npx ts-node scripts/backfill_durations.ts --apply
 *
 * Requirements:
 *   - ffprobe must be available on PATH (ships with ffmpeg).
 *   - Videos stored on the LOCAL disk driver (S3-hosted videos are skipped —
 *     run this on a machine where files are reachable, or extend as needed).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
/** Small delay between files so a large library doesn't hammer the disk */
const DELAY_MS = 100;

async function probeDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

/** Local-storage keys only; external URLs (YouTube/Vimeo/etc.) are skipped */
function resolveLocalPath(videoUrl: string): string | null {
  if (!videoUrl) return null;
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(videoUrl)) return null;
  // Strip scheme/host if present, then any leading "uploads/" segment
  const key = videoUrl
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^uploads\//, '');
  const filePath = path.join(UPLOAD_DIR, key);
  return fs.existsSync(filePath) ? filePath : null;
}

async function main() {
  console.log(`Backfill durations — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Uploads dir: ${UPLOAD_DIR}\n`);

  const lessons = await prisma.lesson.findMany({
    where: { isDeleted: false, videoUrl: { not: '' } },
    select: { id: true, title: true, videoUrl: true, durationSeconds: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${lessons.length} lesson(s) with videos.\n`);

  let updated = 0;
  let skippedExternal = 0;
  let failed = 0;

  for (const lesson of lessons) {
    const filePath = resolveLocalPath(lesson.videoUrl);
    if (!filePath) {
      skippedExternal++;
      continue;
    }

    const realDuration = await probeDurationSeconds(filePath);
    if (realDuration === null) {
      failed++;
      console.log(`✗ [ffprobe failed] ${lesson.id} "${lesson.title}"`);
      continue;
    }

    if (realDuration === lesson.durationSeconds) {
      continue;
    }

    const oldMin = Math.round(lesson.durationSeconds / 60);
    const newMin = Math.floor(realDuration / 60);
    const newSec = realDuration % 60;
    console.log(
      `• ${lesson.id} "${lesson.title}": ${lesson.durationSeconds}s (${oldMin}m) → ${realDuration}s (${newMin}:${String(newSec).padStart(2, '0')})`,
    );

    if (APPLY) {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { durationSeconds: realDuration },
      });
    }
    updated++;
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(
    `\nSummary: ${updated} to update, ${skippedExternal} skipped (external/missing), ${failed} ffprobe failures.`,
  );
  if (!APPLY && updated > 0) {
    console.log('This was a DRY-RUN. Re-run with --apply to write changes.');
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

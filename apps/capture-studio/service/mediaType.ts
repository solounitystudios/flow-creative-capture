import type { AssetType } from '../../../src/domain/enums.js';

/**
 * The smallest reasonable generic file-ingest classification: MIME type
 * first (browsers set `File.type` accurately for common formats), file
 * extension as a fallback when the MIME type is missing or generic
 * (`application/octet-stream`). Deliberately shallow — no content
 * sniffing, no header/magic-byte inspection, no external dependency.
 * This is asset-type classification only; it is NOT EXIF/codec/BPM/
 * waveform intelligence and must never be described as such. See
 * Capture Studio V1's scope notes.
 */

const MIDI_EXTENSIONS = new Set(['mid', 'midi']);
const AUDIO_EXTENSIONS = new Set(['wav', 'aiff', 'aif', 'mp3', 'flac', 'ogg', 'oga', 'm4a', 'wma', 'aac']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'txt', 'doc', 'docx', 'rtf', 'md']);

function extensionOf(filename: string | undefined): string | undefined {
  if (filename === undefined) {
    return undefined;
  }
  const parts = filename.split('.');
  if (parts.length < 2) {
    return undefined;
  }
  return parts[parts.length - 1]?.toLowerCase();
}

export function detectAssetType(originalFilename: string | undefined, mimeType: string | undefined): AssetType {
  const mime = mimeType?.toLowerCase().trim();
  if (mime === 'audio/midi' || mime === 'audio/x-midi') {
    return 'midi';
  }
  if (mime !== undefined && mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime !== undefined && mime.startsWith('image/')) {
    return 'image';
  }
  if (mime !== undefined && mime.startsWith('video/')) {
    return 'video';
  }
  if (mime === 'application/pdf' || (mime !== undefined && mime.startsWith('text/'))) {
    return 'document';
  }

  const ext = extensionOf(originalFilename);
  if (ext !== undefined) {
    if (MIDI_EXTENSIONS.has(ext)) {
      return 'midi';
    }
    if (AUDIO_EXTENSIONS.has(ext)) {
      return 'audio';
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      return 'image';
    }
    if (VIDEO_EXTENSIONS.has(ext)) {
      return 'video';
    }
    if (DOCUMENT_EXTENSIONS.has(ext)) {
      return 'document';
    }
  }

  return 'other';
}

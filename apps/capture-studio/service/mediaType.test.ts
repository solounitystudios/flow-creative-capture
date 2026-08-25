import { describe, expect, it } from 'vitest';
import { detectAssetType } from './mediaType.js';

describe('detectAssetType', () => {
  it('classifies common audio MIME types', () => {
    expect(detectAssetType('take.wav', 'audio/wav')).toBe('audio');
    expect(detectAssetType('take.mp3', 'audio/mpeg')).toBe('audio');
  });

  it('classifies MIDI by MIME type distinctly from generic audio', () => {
    expect(detectAssetType('beat.mid', 'audio/midi')).toBe('midi');
    expect(detectAssetType('beat.mid', 'audio/x-midi')).toBe('midi');
  });

  it('classifies image and video MIME types', () => {
    expect(detectAssetType('cover.png', 'image/png')).toBe('image');
    expect(detectAssetType('clip.mp4', 'video/mp4')).toBe('video');
  });

  it('classifies document MIME types', () => {
    expect(detectAssetType('notes.pdf', 'application/pdf')).toBe('document');
    expect(detectAssetType('notes.txt', 'text/plain')).toBe('document');
  });

  it('falls back to file extension when the MIME type is missing or generic', () => {
    expect(detectAssetType('take.wav', undefined)).toBe('audio');
    expect(detectAssetType('take.wav', 'application/octet-stream')).toBe('audio');
    expect(detectAssetType('beat.mid', 'application/octet-stream')).toBe('midi');
    expect(detectAssetType('photo.jpeg', 'application/octet-stream')).toBe('image');
    expect(detectAssetType('movie.mov', 'application/octet-stream')).toBe('video');
  });

  it('returns "other" for an unrecognized extension and no useful MIME type', () => {
    expect(detectAssetType('project.flp', 'application/octet-stream')).toBe('other');
    expect(detectAssetType(undefined, undefined)).toBe('other');
  });

  it('is case-insensitive for both MIME type and extension', () => {
    expect(detectAssetType('TAKE.WAV', undefined)).toBe('audio');
    expect(detectAssetType('take.wav', 'AUDIO/WAV')).toBe('audio');
  });
});

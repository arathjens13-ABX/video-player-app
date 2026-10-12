export type SniffResult = { ok: true } | { ok: false; reason: string };

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Checks the first bytes of a finished download. Hosts that block a download
 * often still answer 200 with an HTML or JSON error page, which would otherwise
 * be saved as an unplayable ".mp4".
 */
export function sniffVideo(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: 'The download was empty.' };

  // MP4 / MOV / 3GP: a box type at offset 4.
  if (bytes.length >= 8 && /^(ftyp|moov|mdat|free|wide|skip|styp)$/.test(ascii(bytes, 4, 8))) return { ok: true };
  // WebM / Matroska (EBML header).
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ok: true };
  // MPEG transport stream sync byte.
  if (bytes[0] === 0x47) return { ok: true };

  // Skip a UTF-8 byte-order mark (EF BB BF) before looking for text.
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = ascii(bytes, start, Math.min(bytes.length, 64)).trimStart().toLowerCase();
  if (head.startsWith('<')) {
    return {
      ok: false,
      reason: 'The server sent a web page instead of the video. The link may have expired or the host blocked the download.',
    };
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    return { ok: false, reason: 'The server sent an error message instead of the video.' };
  }
  if (head.startsWith('#extm3u')) {
    return { ok: false, reason: 'This link is a stream playlist (.m3u8), not a video file.' };
  }
  // Unknown format: let the player decide rather than throwing away a real file.
  return { ok: true };
}

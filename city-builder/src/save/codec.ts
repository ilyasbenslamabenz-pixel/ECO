/**
 * Encodage des sauvegardes : JSON compressé en gzip via CompressionStream quand le
 * navigateur le fournit (repli : JSON UTF-8 brut). Le décodage détecte le format
 * (en-tête gzip 1f 8b ou texte JSON), puis valide et migre via sim/save-format :
 * un fichier corrompu donne un message, jamais une exception.
 */
import type { SaveFile } from '../shared/contracts';
import { validateSave, type SaveFileV2 } from '../sim/save-format';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined';
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function encodeSave(data: SaveFile, compress = true): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (compress && compressionAvailable()) {
    return { bytes: await pipe(json, new CompressionStream('gzip')), compressed: true };
  }
  return { bytes: json, compressed: false };
}

export interface Decoded { data: SaveFileV2; migratedFrom: number; compressed: boolean }

export async function decodeSave(bytes: Uint8Array): Promise<Result<Decoded>> {
  let text: string;
  const compressed = isGzip(bytes);
  try {
    if (compressed) {
      if (!compressionAvailable()) return { ok: false, message: 'Sauvegarde compressée : ce navigateur ne sait pas la décompresser' };
      text = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(bytes, new DecompressionStream('gzip')));
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    return { ok: false, message: 'Fichier de sauvegarde endommagé (décompression ou encodage invalide)' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, message: 'Fichier de sauvegarde illisible (JSON invalide ou tronqué)' };
  }
  const v = validateSave(raw);
  if (!v.ok) return { ok: false, message: v.message };
  return { ok: true, value: { data: v.save, migratedFrom: v.migratedFrom, compressed } };
}

/** Base64 par blocs (localStorage ne stocke que du texte). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Hand-maintained type declarations for the Impeccable detection API.

export type FindingSeverity = 'warning' | 'advisory' | 'note' | 'error';

export type DetectionEngine = 'regex' | 'static-html' | 'browser' | 'visual';

export interface Finding {
  antipattern: string;
  name: string;
  description: string;
  severity: FindingSeverity;
  category: string;
  engine?: DetectionEngine;
  file: string;
  line: number;
  snippet: string;
  importedBy?: string[];
}

export interface ScanOptions {
  providers?: Array<'gpt' | 'gemini'>;
  lineLengthMax?: number;
}

/**
 * Project configuration loaded from impeccable.config.json, .impeccablerc.json,
 * or the "impeccable" key in package.json.
 */
export interface ImpeccableConfig {
  disabledRules?: string[];
  ignore?: string[];
  severity?: Record<string, 'off' | 'note' | 'warning' | 'error'>;
  lineLengthMax?: number;
}

export function detectText(source: string, filePath: string, options?: ScanOptions): Finding[];
export function detectHtml(filePath: string, options?: ScanOptions): Promise<Finding[]>;
export function detectUrl(url: string, options?: ScanOptions): Promise<Finding[]>;
export function formatFindings(findings: Finding[], jsonMode: boolean): string;

/**
 * Type declarations for contract.mjs (the runtime is plain JS so both Node
 * scripts and the Astro build can import it; these types are for the TS side).
 */
import type { ProspectConfig, BusinessHours } from '../types';

export const SECTION_TYPES: Set<string>;

export const FILLER_DESC_RE: RegExp;
export const TEMPLATED_SERVICE_RE: RegExp;
export const TEMPLATED_ABOUT_RE: RegExp;
export const PLACEHOLDER_EMAIL_RE: RegExp;
export const DEFAULT_HOURS: BusinessHours[];

export function isFillerServiceDescription(s: unknown): boolean;
export function isTemplatedServiceTitle(s: unknown): boolean;
export function isPlaceholderEmail(s: unknown): boolean;
export function isStockImage(src: unknown): boolean;
export function isDefaultHours(hours: unknown): boolean;

export interface ContractResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateProspectConfig(config: unknown): ContractResult;
export function assertValidProspectConfig(config: unknown, slug: string): void;

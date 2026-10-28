import {
  BACKUP_BUFFER_DISABLED,
  BACKUP_BUFFER_MAX_PERCENT,
  BACKUP_BUFFER_MIN_PERCENT,
  isValidBackupBuffer,
  parseBackupBuffer,
  shouldWriteBackupBufferToBattery,
} from '../domain/BackupBuffer';

describe('isValidBackupBuffer', () => {
  it('accepts 0 (disabled) and the full 5-100 percentage range', () => {
    expect(isValidBackupBuffer(BACKUP_BUFFER_DISABLED)).toBe(true);
    expect(isValidBackupBuffer(BACKUP_BUFFER_MIN_PERCENT)).toBe(true);
    expect(isValidBackupBuffer(15)).toBe(true);
    expect(isValidBackupBuffer(BACKUP_BUFFER_MAX_PERCENT)).toBe(true);
  });

  it('rejects the gap between disabled and the percentage range', () => {
    // The battery rejects 1-4 with "Invalid value for EM_USOC"
    for (const invalid of [1, 2, 3, 4]) {
      expect(isValidBackupBuffer(invalid)).toBe(false);
    }
  });

  it('rejects values outside the range', () => {
    expect(isValidBackupBuffer(-1)).toBe(false);
    expect(isValidBackupBuffer(101)).toBe(false);
    expect(isValidBackupBuffer(1000)).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(isValidBackupBuffer(12.5)).toBe(false);
    expect(isValidBackupBuffer(NaN)).toBe(false);
    expect(isValidBackupBuffer(Infinity)).toBe(false);
  });
});

describe('parseBackupBuffer', () => {
  it('parses the string-encoded values the battery reports', () => {
    expect(parseBackupBuffer('0')).toBe(0);
    expect(parseBackupBuffer('15')).toBe(15);
    expect(parseBackupBuffer('100')).toBe(100);
  });

  it('parses numeric values as reported by some firmwares', () => {
    expect(parseBackupBuffer(0)).toBe(0);
    expect(parseBackupBuffer(15)).toBe(15);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseBackupBuffer(' 15 ')).toBe(15);
  });

  it('returns null for absent values so callers keep the last known value', () => {
    expect(parseBackupBuffer(null)).toBeNull();
    expect(parseBackupBuffer(undefined)).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(parseBackupBuffer('')).toBeNull();
    expect(parseBackupBuffer('disabled')).toBeNull();
    expect(parseBackupBuffer({})).toBeNull();
  });
});

describe('shouldWriteBackupBufferToBattery', () => {
  it('writes when nothing has been reported yet', () => {
    expect(shouldWriteBackupBufferToBattery(10, null)).toBe(true);
  });

  it('writes when the user picked a different value than the battery reported', () => {
    expect(shouldWriteBackupBufferToBattery(20, 10)).toBe(true);
  });

  it('does not echo back a value the battery itself just reported', () => {
    // Polling syncs the reported value into the setting; that re-enters
    // onSettings and must not write the value back to the battery.
    expect(shouldWriteBackupBufferToBattery(10, 10)).toBe(false);
  });
});

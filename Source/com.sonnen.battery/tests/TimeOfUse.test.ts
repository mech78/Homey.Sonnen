import { TimeOfUseSchedule, TimeOfUseEntry } from '../domain/TimeOfUse';
import { LocalizedError } from '../domain/LocalizedError';

describe('TimeOfUseSchedule', () => {
  describe('Construction from entries (flow card path)', () => {
    it('should accept a single valid entry and expose it via getSchedule()', () => {
      const schedule = new TimeOfUseSchedule({
        start: '13:15',
        stop: '17:45',
        threshold_p_max: 5000
      });

      expect(schedule.getSchedule()).toEqual([
        { start: '13:15', stop: '17:45', threshold_p_max: 5000 }
      ]);
    });

    it('should accept an entry with 0 W threshold (pause case)', () => {
      const schedule = new TimeOfUseSchedule({
        start: '09:00',
        stop: '11:30',
        threshold_p_max: 0
      });

      expect(schedule.getSchedule()[0].threshold_p_max).toBe(0);
    });

    it('should accept multiple valid entries', () => {
      const entries: TimeOfUseEntry[] = [
        { start: '06:00', stop: '08:00', threshold_p_max: 2000 },
        { start: '17:00', stop: '21:00', threshold_p_max: 46000 }
      ];

      const schedule = new TimeOfUseSchedule(entries);

      expect(schedule.getSchedule()).toHaveLength(2);
      expect(schedule.getSchedule()[0]).toEqual(entries[0]);
      expect(schedule.getSchedule()[1]).toEqual(entries[1]);
    });

    it('should return a shallow copy from getSchedule() so structural mutation does not affect the schedule', () => {
      const schedule = new TimeOfUseSchedule({
        start: '13:15',
        stop: '17:45',
        threshold_p_max: 5000
      });

      const copy = schedule.getSchedule();
      copy.push({ start: '00:00', stop: '00:00', threshold_p_max: 0 });
      copy.splice(0, 1);

      expect(schedule.getSchedule()).toEqual([
        { start: '13:15', stop: '17:45', threshold_p_max: 5000 }
      ]);
    });

    it('should serialize to a JSON string matching the API payload shape', () => {
      const schedule = new TimeOfUseSchedule({
        start: '13:15',
        stop: '17:45',
        threshold_p_max: 5000
      });

      expect(schedule.toJSONString()).toBe(
        '[{"start":"13:15","stop":"17:45","threshold_p_max":5000}]'
      );
    });
  });

  describe('Time format validation (protects string-based flow card args)', () => {
    const invalidTimes = ['25:00', '24:00', '13:5', 'ab:cd', '13:15:30', ''];

    it.each(invalidTimes)('should reject invalid time "%s"', (time) => {
      expect(() => new TimeOfUseSchedule({
        start: time,
        stop: '17:45',
        threshold_p_max: 5000
      })).toThrow(LocalizedError);
    });

    it('should reject an invalid stop time', () => {
      expect(() => new TimeOfUseSchedule({
        start: '13:15',
        stop: '99:99',
        threshold_p_max: 5000
      })).toThrow(LocalizedError);
    });

    it('should report the i18n key for an invalid time format', () => {
      let error: unknown;
      try {
        new TimeOfUseSchedule({ start: '25:00', stop: '17:45', threshold_p_max: 5000 });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(LocalizedError);
      expect((error as LocalizedError).i18nKey).toBe('error.validation.invalid_schedule_item_time_format');
    });

    it('should accept times surrounded by whitespace (trimmed)', () => {
      const schedule = new TimeOfUseSchedule({
        start: ' 13:15 ',
        stop: '\t17:45\n',
        threshold_p_max: 5000
      });

      expect(schedule.getSchedule()[0].start).toBe('13:15');
      expect(schedule.getSchedule()[0].stop).toBe('17:45');
    });

    it('should accept boundary times 00:00 and 23:59', () => {
      const schedule = new TimeOfUseSchedule({
        start: '00:00',
        stop: '23:59',
        threshold_p_max: 5000
      });

      expect(schedule.getSchedule()[0].start).toBe('00:00');
      expect(schedule.getSchedule()[0].stop).toBe('23:59');
    });

    it('should reject entries with missing or wrong-typed properties', () => {
      expect(() => new TimeOfUseSchedule({
        start: 1315,
        stop: '17:45',
        threshold_p_max: 5000
      } as unknown as TimeOfUseEntry)).toThrow(LocalizedError);
    });
  });

  describe('Construction from JSON string (device settings path)', () => {
    it('should parse a valid JSON array of entries', () => {
      const schedule = new TimeOfUseSchedule(
        '[{"start":"13:15","stop":"17:45","threshold_p_max":5000}]'
      );

      expect(schedule.getSchedule()).toEqual([
        { start: '13:15', stop: '17:45', threshold_p_max: 5000 }
      ]);
    });

    it('should accept an empty JSON array', () => {
      const schedule = new TimeOfUseSchedule('[]');

      expect(schedule.getSchedule()).toHaveLength(0);
    });

    it('should reject malformed JSON', () => {
      expect(() => new TimeOfUseSchedule('not json')).toThrow(LocalizedError);
    });

    it('should reject valid JSON that is not an array', () => {
      expect(() => new TimeOfUseSchedule('{"start":"13:15"}')).toThrow(LocalizedError);
    });
  });

  describe('toString / fromString round-trip', () => {
    it('should round-trip a multi-entry schedule through toString and fromString', () => {
      const entries: TimeOfUseEntry[] = [
        { start: '06:00', stop: '08:00', threshold_p_max: 2000 },
        { start: '17:00', stop: '21:00', threshold_p_max: 46000 }
      ];
      const original = new TimeOfUseSchedule(entries);

      const parsed = TimeOfUseSchedule.fromString(original.toString());

      expect(parsed.getSchedule()).toEqual(entries);
    });

    it('should produce the expected display format', () => {
      const schedule = new TimeOfUseSchedule([
        { start: '06:00', stop: '08:00', threshold_p_max: 2000 },
        { start: '17:00', stop: '21:00', threshold_p_max: 46000 }
      ]);

      expect(schedule.toString()).toBe('06:00-08:00: 2000W\n17:00-21:00: 46000W');
    });

    it('should return an empty schedule for an empty string', () => {
      expect(TimeOfUseSchedule.fromString('').getSchedule()).toHaveLength(0);
      expect(TimeOfUseSchedule.fromString('   ').getSchedule()).toHaveLength(0);
    });

    it('should reject malformed schedule lines', () => {
      expect(() => TimeOfUseSchedule.fromString('06:00-08:00')).toThrow(LocalizedError);
    });
  });
});

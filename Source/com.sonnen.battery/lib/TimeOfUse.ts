/**
 * Interface representing a single Time-of-Use schedule event
 */
export interface TimeOfUseEvent {
  /**
   * Start time in HH:MM format
   */
  start: string;
  
  /**
   * Stop time in HH:MM format
   */
  stop: string;
  
  /**
   * Maximum power threshold in watts
   */
  threshold_p_max: number;
}

/**
 * Class for parsing and managing Time-of-Use schedules
 */
export class TimeOfUseSchedule {
  private schedule: TimeOfUseEvent[];
  
  /**
   * Creates a new TimeOfUseSchedule instance
   * @param jsonString The JSON string representation of the schedule
   */
  constructor(jsonString: string) {
    // console.log('Initializing TimeOfUseSchedule with JSON:', jsonString);
    this.schedule = this.parseSchedule(jsonString);
  }
  
  /**
   * Parses the JSON string into an array of TimeOfUseItem objects
   * @param jsonString The JSON string representation of the schedule
   * @returns Array of TimeOfUseItem objects
   */
  private parseSchedule(jsonString: string): TimeOfUseEvent[] {
    try {
      // Parse the JSON string
      const parsed = JSON.parse(jsonString);
      
      // Validate that it's an array
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid schedule format: expected an array');
      }
      
      // Validate each item in the array
      const schedule: TimeOfUseEvent[] = parsed.map((item, index: number) => {
        // Check required properties
        if (typeof item.start !== 'string' || typeof item.stop !== 'string' || typeof item.threshold_p_max !== 'number') {
          throw new Error(`Invalid schedule item at index ${index}: missing required properties`);
        }
        
        // Validate time format (HH:MM)
        if (!this.isValidTimeFormat(item.start) || !this.isValidTimeFormat(item.stop)) {
          throw new Error(`Invalid schedule item at index ${index}: invalid time format`);
        }
        
        return {
          start: item.start,
          stop: item.stop,
          threshold_p_max: item.threshold_p_max
        };
      });
      
      return schedule;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse schedule JSON: ${error.message}`);
      }
      throw error;
    }
  }
  
  /**
   * Validates if a string is in HH:MM format
   * @param time The time string to validate
   * @returns True if valid, false otherwise
   */
  private isValidTimeFormat(time: string): boolean {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }
  
  /**
   * Gets the entire schedule
   * @returns Array of TimeOfUseItem objects
   */
  public getSchedule(): TimeOfUseEvent[] {
    return [...this.schedule]; // Return a copy to prevent external modification
  }
  
  /**
   * Converts the schedule back to its JSON string representation
   * @returns The JSON string representation of the schedule
   */
  public toJSONString(): string {
    return JSON.stringify(this.schedule);
  }
  
  /**
   * Returns a string representation of the schedule
   * @returns A formatted string representation
   */
  public toString(): string {
    return this.schedule.map(item => 
      `${item.start}-${item.stop}: ${item.threshold_p_max}W`
    ).join(', ');
  }
}
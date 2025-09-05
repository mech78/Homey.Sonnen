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
  constructor(jsonString: string);
  /**
   * Creates a new TimeOfUseSchedule instance from a single TimeOfUseEvent
   * @param event The TimeOfUseEvent to create the schedule from
   */
  constructor(event: TimeOfUseEvent);
  /**
   * Creates a new TimeOfUseSchedule instance from multiple TimeOfUseEvents
   * @param events Array of TimeOfUseEvents to create the schedule from
   */
  constructor(events: TimeOfUseEvent[]);
  /**
   * Creates a new TimeOfUseSchedule instance
   * @param source The source to create the schedule from (JSON string, single event, or array of events)
   */
  constructor(source: string | TimeOfUseEvent | TimeOfUseEvent[]) {
    let events: TimeOfUseEvent[];
    
    if (typeof source === 'string') {
      // Parse JSON string to get array of events
      try {
        const parsed = JSON.parse(source);
        
        // Validate that it's an array
        if (!Array.isArray(parsed)) {
          throw new Error('Invalid schedule format: expected an array');
        }
        
        events = parsed;
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`Failed to parse schedule JSON: ${error.message}`);
        }
        throw error;
      }
    } else if (Array.isArray(source)) {
      events = source;
    } else {
      events = [source];
    }
    
    // Validate and copy all events
    this.schedule = this.validateAndCopyEvents(events);
  }
  
  
  /**
   * Validates if a string is in HH:MM format
   * @param time The time string to validate
   * @returns True if valid, false otherwise
   */
  private isValidTimeFormat(time: string): boolean {
    const timeRegex = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }
  
  /**
   * Validates and copies an array of TimeOfUseEvent objects
   * @param events Array of TimeOfUseEvent objects to validate and copy
   * @returns Validated and copied array of TimeOfUseEvent objects
   */
  private validateAndCopyEvents(events: TimeOfUseEvent[]): TimeOfUseEvent[] {
    return events.map((event, index) => {
      // Check required properties
      if (typeof event.start !== 'string' || typeof event.stop !== 'string' || typeof event.threshold_p_max !== 'number') {
        throw new Error(`Invalid schedule item at index ${index}: missing required properties`);
      }
      
      // Validate time format (HH:MM)
      if (!this.isValidTimeFormat(event.start) || !this.isValidTimeFormat(event.stop)) {
        throw new Error(`Invalid schedule item at index ${index}: invalid time format`);
      }
      
      return {
        start: event.start,
        stop: event.stop,
        threshold_p_max: event.threshold_p_max
      };
    });
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
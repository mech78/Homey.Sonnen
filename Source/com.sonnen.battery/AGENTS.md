# Agent Configuration Guide

This document provides essential information for AI coding agents working with this Homey app for Sonnen Batterie integration.

## Project Overview

This is a Homey app built with TypeScript that integrates with Sonnen Batterie systems. It provides capabilities for monitoring and controlling battery systems, including Time-of-Use scheduling and prognosis charging features.

## Build/Lint/Test Commands

### Build Commands
```bash
# Compile TypeScript to JavaScript
npm run build

# Clean build artifacts
rm -rf .homeybuild/
```

### Linting Commands
```bash
# Run ESLint to check for code style issues
npm run lint

# Run ESLint and automatically fix issues where possible
npm run lint:fix
```

### Testing Commands
```bash
# Note: This project doesn't appear to have unit tests configured
# Testing is typically done through Homey app testing procedures
```

Running a single test:
Since this project doesn't have explicit unit tests configured, testing is done through Homey's app development framework:
1. Install the app on a Homey device or simulator
2. Find more Homey CLI documentation: https://apps.developer.homey.app/the-basics/getting-started
3. Use Homey CLI for development testing:
```bash
# Install Homey CLI if not already installed
npm install --global --no-optional homey

# Run the app in development mode in WSL/Linux & Docker
homey app run

# Run the app in development mode without Docker
homey app run --remote

# Validate app structure
homey app validate
```

## Code Style Guidelines

### Imports
1. Use ES6 import/export syntax consistently
2. Import ordering:
   - External libraries (e.g., 'homey', 'underscore', 'axios')
   - Internal modules (relative paths)
3. Group related imports with blank lines
4. Avoid default exports; prefer named exports
5. Use destructuring imports when importing specific functions/objects

Example:
```typescript
import Homey from 'homey';
import _ from 'underscore';

import { SonnenState } from '../../domain/SonnenState';
import { LocalizedError } from '../../domain/LocalizedError';
```

### Formatting
1. Use 2-space indentation (as per ESLint config)
2. Line width: 100 characters maximum
3. Always use semicolons
4. Trailing commas in multi-line object/array literals
5. Space after keywords: `if (condition)` not `if(condition)`
6. Spaces around operators: `a = b + c` not `a=b+c`
7. Opening braces on same line:
```typescript
if (condition) {
  // code
}
```

### Types
1. Use TypeScript strict mode (enabled in tsconfig.json)
2. Explicitly type all function parameters and return values
3. Prefer interfaces over types for object shapes
4. Use `readonly` for properties that shouldn't change
5. Use union types for constrained string/number values
6. Avoid `any` type unless absolutely necessary (ESLint warns on usage)
7. Use `unknown` instead of `any` for error handling

### Naming Conventions
1. Use PascalCase for classes, interfaces, and types
2. Use camelCase for variables, functions, and methods
3. Use UPPER_SNAKE_CASE for constants
4. Use descriptive names; avoid abbreviations unless widely understood
5. Boolean variables should start with `is`, `has`, `should`, etc.
6. Event handlers should start with `on` (e.g., `onInit`, `onSettings`)
7. Async functions should be prefixed with `async` or clearly indicate they're asynchronous

Examples:
```typescript
// Classes and interfaces
class BatteryDevice extends SonnenDevice {}
interface SonnenStateConfig {}

// Variables and functions
const batteryPullInterval = 30;
function loadLatestState(): Promise<SonnenState> {}

// Constants
const MODE_TIME_OF_USE = "10";

// Booleans
const isScheduleEmpty = schedule.trim() === '';
```

### Error Handling
1. Use the custom `LocalizedError` class for domain-specific errors that need localization
2. Throw errors with descriptive messages
3. Catch errors at appropriate levels
4. Log errors appropriately using `this.log()` or `this.error()` in device/driver classes
5. Use the `LocalizationService` to properly handle localized error messages
6. Don't swallow errors silently

Example:
```typescript
try {
  await this.createSonnenBatterieClient().setOperatingMode(newOperatingMode);
} catch (error) {
  LocalizationService.getInstance().throwLocalizedError(error);
}
```

### Device/Driver Structure
1. Extend appropriate Homey base classes (`Homey.Device`, `Homey.Driver`, `Homey.App`)
2. Implement lifecycle methods: `onInit()`, `onUninit()`, `onDeleted()`
3. Use `this.homey.setInterval()` and `this.homey.clearInterval()` for timers
4. Store state in `this.homey.settings` for persistence
5. Register capability listeners with `this.registerCapabilityListener()`
6. Use `this.setCapabilityValue()` to update device capabilities

### Domain Layer
1. Separate business logic into domain classes
2. Use value objects for complex data structures
3. Keep domain classes independent of Homey APIs
4. Use services for cross-cutting concerns like localization

### Async/Await
1. Prefer async/await over callbacks
2. Handle promise rejections appropriately
3. Use Promise.all() for concurrent async operations when possible

Example:
```typescript
const [latestDataJson, statusJson, configurationsJson] = await Promise.all([
  client.getLatestData(),
  client.getStatus(),
  client.getConfigurations()
]);
```

## Project-Specific Patterns

### Localization Pattern
The project uses a `LocalizationService` singleton pattern:
```typescript
LocalizationService.getInstance().throwLocalizedError(
  new LocalizedError("error.validation.invalid_ip_format")
);
```

### State Management
Device state is managed through the `SonnenState` class and persisted using Homey settings:
```typescript
this.homey.settings.set('deviceState', this.state);
const storedState = this.homey.settings.get('deviceState');
```

### API Client Usage
API interactions are encapsulated in the `SonnenBatterieClient`:
```typescript
const client = this.createSonnenBatterieClient();
const latestDataJson = await client.getLatestData();
```

## Homey-Specific Considerations

1. Follow Homey app structure conventions
2. Use `.homeycompose/` for capability definitions
3. Place driver-specific assets in driver folders
4. Use Homey's built-in logging: `this.log()`, `this.error()`
5. Respect Homey's lifecycle methods and event system

## ESLint Rules Summary

Key enforced rules from eslint.config.js:
- No unused variables (variables prefixed with `_` are ignored)
- Prefer const over var
- Use arrow functions where appropriate
- No duplicate imports
- Console usage generates warnings
- Strict equality (===) enforcement
- Curly braces required for all blocks

## Development Workflow

1. Make changes to TypeScript files
2. Run `npm run lint` to check code style
3. Run `npm run build` to compile
4. Test using Homey CLI or deploy to device
5. Commit changes with descriptive messages

## Troubleshooting Tips

1. If device state isn't persisting, check `saveDeviceState()` calls
2. For connection issues, verify IP settings and network connectivity
3. For capability errors, check `.homeycompose/` definitions
4. For localization issues, verify keys in `/locales/` JSON files
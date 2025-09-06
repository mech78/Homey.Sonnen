# Project Rules and Guidelines

This document outlines the rules, guidelines, and best practices for developing and maintaining this Homey app. These rules are designed to ensure code quality, consistency, and maintainability across the project.

## 1. Project Overview

This is a Homey app for integrating with Sonnen Battery systems, specifically focusing on Time-of-Use (ToU) functionality. The app is built using:

- **TypeScript** as the primary language
- **Node.js** runtime environment
- **Homey Apps SDK v3**
- **Axios** for HTTP requests
- **Underscore.js** for utility functions

### Key Components

- Main app class: `BatteryApp` in `app.ts`
- Multiple drivers for different Sonnen components:
  - `sonnenbatterie` (main battery unit)
  - `sonnenbatterie_gridmeter` (grid meter)
  - `sonnenbatterie_householdmeter` (household meter)
  - `sonnenbatterie_solarpanel` (solar panels)
- Service layer: `SonnenBatterieClient` for API interactions
- Domain models: `SonnenState`, `SonnenCommandResult`
- Base classes: `SonnenDevice`, `SonnenDriver`
- Widget for visualization: `sonnen-batterie`

## 2. TypeScript Coding Standards

### 2.1 General TypeScript Rules

- Use strict typing wherever possible
- Avoid using `any` type unless absolutely necessary
- Use interfaces for data structures when appropriate
- Use classes for entities with behavior
- Follow naming conventions:
  - Classes: PascalCase
  - Variables/functions: camelCase
  - Constants: UPPER_SNAKE_CASE

### 2.2 Type Safety

- Enable strict mode in `tsconfig.json`
- Use union types instead of enums when possible for better compatibility
- Define explicit return types for all functions
- Use generics appropriately for reusable components

### 2.3 Module Organization

- Use ES6 import/export syntax
- Group related functionality in modules
- Prefer named exports over default exports
- Keep imports organized alphabetically

## 3. Homey App Development Guidelines

### 3.1 Driver Implementation

- Extend `SonnenDriver` base class for all drivers
- Implement `onInit()` method to register flow cards
- Register action cards using `this.homey.flow.getActionCard()`
- Register condition cards using `this.homey.flow.getConditionCard()`
- Handle errors gracefully and provide meaningful error messages

### 3.2 Device Implementation

- Extend `SonnenDevice` base class for all devices
- Implement proper lifecycle methods:
  - `onInit()` for initialization
  - `onUninit()` for cleanup
  - `onAdded()` for post-pairing setup
  - `onDeleted()` for removal cleanup
  - `onSettings()` for handling setting changes
- Use capability listeners for real-time updates
- Store device-specific backend data using `setStoreValue()` and read using `getStoreValue()`
- Store device-specific frontend or user changeable data using `setSettings()` and read using `getSetting()`

### 3.3 Flow Cards

#### Actions
- Provide clear, descriptive titles in English and localized versions
- Use appropriate argument types (device, number, time, text, etc.)
- Include helpful hints for users
- Validate inputs where appropriate
- Handle errors and provide feedback through notifications

#### Conditions
- Return boolean values for condition evaluation
- Log relevant information for debugging
- Handle edge cases appropriately

### 3.4 Capabilities

- Use standardized Homey capabilities when possible
- Define custom capabilities in `app.json`
- Implement proper capability listeners
- Update capability values using `setCapabilityValue()`
- Consider energy support using `isEnergyFullySupported()`

### 3.5 Generated Files

- Avoid editing files that contain markers like `This file is generated`
- Edit referenced source file and generate file using `homey app validate` CLI tool instead

## 4. API Integration Guidelines

### 4.1 Sonnen Battery API

- Use `SonnenBatterieClient` for all API interactions
- Handle authentication through Auth-Token header
- Implement proper error handling for API responses
- Use consistent base URL construction with `getBaseUrl()`
- Follow the API documentation for endpoint usage

### 4.2 HTTP Requests

- Use Axios for all HTTP requests
- Implement proper request/response handling
- Handle network errors gracefully
- Use appropriate HTTP methods (GET, POST, PUT, DELETE)
- Set proper headers for API requests

### 4.3 Data Processing

- Use `SonnenState` for managing device state
- Implement proper data aggregation for energy calculations
- Handle timestamp conversions correctly
- Validate incoming data before processing
- Log relevant information for debugging

## 5. Error Handling and Logging

### 5.1 Error Handling

- Use try/catch blocks for asynchronous operations
- Provide meaningful error messages to users
- Log errors with sufficient context for debugging
- Handle API errors gracefully
- Implement fallback mechanisms where appropriate

### 5.2 Logging

- Use `this.log()` for general logging
- Use `this.error()` for error logging
- Include relevant context in log messages
- Avoid logging sensitive information
- Use appropriate log levels (debug, info, warn, error)

## 6. Testing and Quality Assurance

### 6.1 Unit Testing

- Write unit tests for service layer components
- Test error conditions and edge cases
- Use mocking for external dependencies
- Maintain high test coverage for critical functionality

### 6.2 Integration Testing

- Test API integrations with real endpoints when possible
- Verify flow card functionality
- Test device pairing and discovery
- Validate capability updates

### 6.3 Code Quality

- Follow established coding standards
- Use ESLint for code linting
- Maintain consistent code formatting
- Document complex logic with comments
- Keep functions small and focused

## 7. Internationalization (i18n)

### 7.1 Localization Files

- Maintain localization files in `locales/` directory
- Provide translations for all user-facing strings
- Use consistent key naming conventions
- Support at least English (en) and German (de)

### 7.2 String Usage

- Use `this.homey.__()` for localized strings
- Avoid hardcoded strings in UI components
- Provide context for translators in comments
- Test with different languages

## 8. Performance Optimization

### 8.1 Resource Management

- Clean up intervals and timeouts in `onUninit()`
- Avoid memory leaks by properly disposing resources
- Cache expensive computations when appropriate
- Limit the frequency of API calls

### 8.2 Data Handling

- Process data efficiently
- Avoid unnecessary data transformations
- Use streaming for large data sets when possible
- Implement proper data caching strategies

## 9. Security Considerations

### 9.1 Authentication

- Securely store authentication tokens
- Use encrypted storage for sensitive data
- Implement token refresh mechanisms
- Validate authentication before API calls

### 9.2 Data Protection

- Avoid logging sensitive information
- Sanitize user inputs
- Validate data before processing
- Implement proper access controls

## 10. Documentation Standards

### 10.1 Code Documentation

- Use JSDoc comments for all public methods
- Document complex algorithms and business logic
- Keep documentation up to date with code changes
- Provide examples for complex functionality

### 10.2 Project Documentation

- Maintain README.md with project overview
- Document installation and setup procedures
- Provide usage examples
- Keep changelog updated

## 11. Version Control and Deployment

### 11.1 Git Workflow

- Use feature branches for development
- Write descriptive commit messages
- Squash commits when merging to main branch
- Tag releases appropriately

### 11.2 Release Management

- Follow semantic versioning
- Update version in `app.json` for each release
- Maintain changelog in `.homeychangelog.json`
- Test thoroughly before releasing

## 12. Extensibility Guidelines

### 12.1 Adding New Drivers

1. Create a new directory in `drivers/`
2. Implement driver class extending `SonnenDriver`
3. Create device class extending `SonnenDevice`
4. Define flow cards in driver configuration files
5. Add necessary assets (icons, images)
6. Update `app.json` with new driver information

### 12.2 Adding New Capabilities

1. Define capability in `app.json`
2. Add capability to appropriate devices
3. Implement capability listeners if needed
4. Update widget if visualization is required
5. Add localization strings

### 12.3 Adding New API Endpoints

1. Extend `SonnenBatterieClient` with new methods
2. Create corresponding domain models if needed
3. Implement error handling for new endpoints
4. Add unit tests for new functionality
5. Update documentation

## 13. Troubleshooting and Debugging

### 13.1 Common Issues

- Network connectivity problems
- Authentication failures
- API rate limiting
- Data synchronization issues

### 13.2 Debugging Techniques

- Use Homey Developer Tools for logging
- Enable debug mode for detailed output
- Check Homey app logs in the dashboard
- Use breakpoints in the code for step-by-step debugging

## 14. Future Development Considerations

### 14.1 Planned Features

- Enhanced energy reporting
- Advanced scheduling options
- Integration with other smart home devices
- Mobile app integration

### 14.2 Technical Debt

- Refactor legacy code as needed
- Improve test coverage
- Optimize performance bottlenecks
- Update dependencies regularly

## 15. Community and Support

### 15.1 User Support

- Monitor Homey community forums
- Respond to user feedback promptly
- Provide clear documentation for common issues
- Maintain a FAQ for frequently asked questions

### 15.2 Contribution Guidelines

- Welcome community contributions
- Provide clear guidelines for submitting issues
- Review pull requests promptly
- Maintain code quality standards for contributions

## 16 Available Documentation and API Specifications

### 16.1 Homey Apps SDK v3

- https://apps.developer.homey.app/
- https://apps-sdk-v3.developer.homey.app/

### 16.2. SonnenBatterie API v2

- https://jlunz.github.io/homeassistant/

## 17 Available CLI Tools

### 17.1 Homey Apps

- Validate the app using `homey app validate` to ensure deploying to Homey works
- Run the app on Homey for debugging and testing using `homey app run --remote`
- Install the app to Homey using `homey app install`


---

*This document is a living document and should be updated as the project evolves. Last updated: {{date}}*
import { Logger } from '../../../src/shared/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('TestService');
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('info', () => {
    it('should log info message with correct format', () => {
      const message = 'Test info message';
      const meta = { userId: '123' };

      logger.info(message, meta);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"level":"INFO"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"service":"TestService"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test info message"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"userId":"123"')
      );
    });

    it('should include correlation ID when set', () => {
      const correlationId = 'test-correlation-id';
      logger.setCorrelationId(correlationId);
      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`"correlationId":"${correlationId}"`)
      );
    });
  });

  describe('error', () => {
    it('should log error with stack trace', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"level":"ERROR"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorName":"Error"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorMessage":"Test error"')
      );
    });
  });
});
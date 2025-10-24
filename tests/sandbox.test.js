const { SandboxExecutor, TaskTemplateHelpers } = require('../utils/sandbox');

describe('SandboxExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new SandboxExecutor({
      timeout: 1000,
      memoryLimit: 64,
      console: false
    });
  });

  describe('executeGenerator', () => {
    test('should execute simple generator script', () => {
      const script = `
        return {
          x: Math.random() * 100,
          y: Math.random() * 100,
          description: "Test task"
        };
      `;

      const result = executor.executeGenerator(script, 0, 12345);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('x');
      expect(result.data).toHaveProperty('y');
      expect(result.data).toHaveProperty('description');
      expect(typeof result.data.x).toBe('number');
      expect(typeof result.data.y).toBe('number');
    });

    test('should handle generator script with parameters', () => {
      const script = `
        return {
          variantIndex: variantIndex,
          seed: seed,
          x: Math.sin(variantIndex) * 100,
          y: Math.cos(variantIndex) * 100
        };
      `;

      const result = executor.executeGenerator(script, 5, 67890);
      
      expect(result.success).toBe(true);
      expect(result.data.variantIndex).toBe(5);
      expect(result.data.seed).toBe(67890);
    });

    test('should handle invalid generator script', () => {
      const script = `
        invalid syntax here
        return { x: 1 };
      `;

      const result = executor.executeGenerator(script, 0, 12345);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle dangerous operations', () => {
      const script = `
        require('fs');
        return { x: 1 };
      `;

      const result = executor.executeGenerator(script, 0, 12345);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executeSolution', () => {
    test('should execute simple solution script', () => {
      const script = `
        const { x, y } = inputData;
        return {
          distance: Math.sqrt(x * x + y * y)
        };
      `;

      const inputData = { x: 3, y: 4 };
      const result = executor.executeSolution(script, inputData);
      
      expect(result.success).toBe(true);
      expect(result.data.distance).toBe(5);
    });

    test('should handle complex solution script', () => {
      const script = `
        const { x1, y1, x2, y2 } = inputData;
        const dx = x2 - x1;
        const dy = y2 - y1;
        return {
          distance: Math.sqrt(dx * dx + dy * dy),
          angle: Math.atan2(dy, dx)
        };
      `;

      const inputData = { x1: 0, y1: 0, x2: 3, y2: 4 };
      const result = executor.executeSolution(script, inputData);
      
      expect(result.success).toBe(true);
      expect(result.data.distance).toBe(5);
      expect(typeof result.data.angle).toBe('number');
    });

    test('should handle invalid solution script', () => {
      const script = `
        invalid syntax
        return { result: 1 };
      `;

      const inputData = { x: 1, y: 2 };
      const result = executor.executeSolution(script, inputData);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validateScript', () => {
    test('should validate correct script', () => {
      const script = `
        const x = Math.random();
        return { value: x };
      `;

      const validation = executor.validateScript(script);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should detect dangerous patterns', () => {
      const script = `
        require('fs');
        return { value: 1 };
      `;

      const validation = executor.validateScript(script);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    test('should detect syntax errors', () => {
      const script = `
        const x = ;
        return { value: x };
      `;

      const validation = executor.validateScript(script);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('TaskTemplateHelpers', () => {
  describe('generateCoordinateTransformation', () => {
    test('should generate coordinate transformation task', () => {
      const result = TaskTemplateHelpers.generateCoordinateTransformation(0, 12345);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('inputData');
      expect(result.data.inputData).toHaveProperty('x1');
      expect(result.data.inputData).toHaveProperty('y1');
      expect(result.data.inputData).toHaveProperty('angle');
      expect(result.data.inputData).toHaveProperty('scale');
      expect(result.data.inputData).toHaveProperty('dx');
      expect(result.data.inputData).toHaveProperty('dy');
    });
  });

  describe('generateForwardIntersection', () => {
    test('should generate forward intersection task', () => {
      const result = TaskTemplateHelpers.generateForwardIntersection(0, 12345);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('inputData');
      expect(result.data.inputData).toHaveProperty('x1');
      expect(result.data.inputData).toHaveProperty('y1');
      expect(result.data.inputData).toHaveProperty('x2');
      expect(result.data.inputData).toHaveProperty('y2');
      expect(result.data.inputData).toHaveProperty('angle1');
      expect(result.data.inputData).toHaveProperty('angle2');
    });
  });

  describe('generateDistanceCalculation', () => {
    test('should generate distance calculation task', () => {
      const result = TaskTemplateHelpers.generateDistanceCalculation(0, 12345);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('inputData');
      expect(result.data.inputData).toHaveProperty('x1');
      expect(result.data.inputData).toHaveProperty('y1');
      expect(result.data.inputData).toHaveProperty('x2');
      expect(result.data.inputData).toHaveProperty('y2');
    });
  });
});

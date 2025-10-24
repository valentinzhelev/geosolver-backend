const { VM } = require('vm2');

/**
 * Sandbox execution utility for safe JavaScript code execution
 * Used for task template generator and solution scripts
 */

class SandboxExecutor {
  constructor(options = {}) {
    this.timeout = options.timeout || 5000; // 5 seconds timeout
    this.memoryLimit = options.memoryLimit || 128; // 128MB memory limit
    this.console = options.console || false; // Allow console output
  }

  /**
   * Create a secure VM instance
   */
  createVM() {
    return new VM({
      timeout: this.timeout,
      sandbox: {
        // Math functions
        Math,
        // Date functions
        Date,
        // JSON functions
        JSON,
        // Basic number functions
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        // Console (optional)
        ...(this.console && { console }),
        // Custom allowed functions
        generateRandom: this.generateRandom.bind(this),
        calculateDistance: this.calculateDistance.bind(this),
        calculateAngle: this.calculateAngle.bind(this),
        // Trigonometric functions
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        asin: Math.asin,
        acos: Math.acos,
        atan: Math.atan,
        atan2: Math.atan2,
        // Other math functions
        sqrt: Math.sqrt,
        pow: Math.pow,
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        min: Math.min,
        max: Math.max,
        PI: Math.PI,
        E: Math.E
      }
    });
  }

  /**
   * Execute generator script safely
   */
  executeGenerator(script, variantIndex = 0, seed = null) {
    try {
      const vm = this.createVM();
      
      // Set seed for reproducible results
      if (seed !== null) {
        vm.run(`
          Math.random = function() {
            const x = Math.sin(${seed}) * 10000;
            return x - Math.floor(x);
          };
        `);
      }

      // Execute the generator script
      const result = vm.run(`
        (function(variantIndex, seed) {
          ${script}
        })(${variantIndex}, ${seed});
      `);

      return {
        success: true,
        data: result,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Execute solution script safely
   */
  executeSolution(script, inputData) {
    try {
      const vm = this.createVM();
      
      // Execute the solution script with input data
      const result = vm.run(`
        (function(inputData) {
          ${script}
        })(${JSON.stringify(inputData)});
      `);

      return {
        success: true,
        data: result,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Validate script syntax and security
   */
  validateScript(script) {
    const errors = [];
    const warnings = [];

    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/,
      /import\s+/,
      /eval\s*\(/,
      /Function\s*\(/,
      /process\./,
      /global\./,
      /__dirname/,
      /__filename/,
      /fs\./,
      /child_process/,
      /exec\s*\(/,
      /spawn\s*\(/,
      /while\s*\(/,
      /for\s*\(/,
      /setTimeout/,
      /setInterval/,
      /XMLHttpRequest/,
      /fetch\s*\(/
    ];

    dangerousPatterns.forEach((pattern, index) => {
      if (pattern.test(script)) {
        errors.push(`Dangerous pattern detected: ${pattern.source}`);
      }
    });

    // Check for infinite loops (basic check)
    if (script.includes('while(true)') || script.includes('for(;;)')) {
      warnings.push('Potential infinite loop detected');
    }

    // Check script length
    if (script.length > 10000) {
      warnings.push('Script is very long, consider optimization');
    }

    // Try to parse as function
    try {
      new Function(script);
    } catch (error) {
      errors.push(`Syntax error: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Generate random number with seed
   */
  generateRandom(min = 0, max = 1) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Calculate distance between two points
   */
  calculateDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  /**
   * Calculate angle between two points
   */
  calculateAngle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }
}

/**
 * Task template examples and helpers
 */
class TaskTemplateHelpers {
  /**
   * Generate coordinate transformation task
   */
  static generateCoordinateTransformation(variantIndex, seed) {
    const executor = new SandboxExecutor();
    
    const script = `
      // Generate random coordinates
      const x1 = Math.random() * 1000 - 500;
      const y1 = Math.random() * 1000 - 500;
      const angle = Math.random() * 2 * Math.PI;
      const scale = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
      const dx = Math.random() * 100 - 50;
      const dy = Math.random() * 100 - 50;
      
      return {
        input: {
          x1: Math.round(x1 * 100) / 100,
          y1: Math.round(y1 * 100) / 100,
          angle: Math.round(angle * 1000) / 1000,
          scale: Math.round(scale * 1000) / 1000,
          dx: Math.round(dx * 100) / 100,
          dy: Math.round(dy * 100) / 100
        },
        description: "Transform the given coordinates using the transformation parameters"
      };
    `;
    
    return executor.executeGenerator(script, variantIndex, seed);
  }

  /**
   * Generate forward intersection task
   */
  static generateForwardIntersection(variantIndex, seed) {
    const executor = new SandboxExecutor();
    
    const script = `
      // Generate known points and angles
      const x1 = Math.random() * 1000 - 500;
      const y1 = Math.random() * 1000 - 500;
      const x2 = Math.random() * 1000 - 500;
      const y2 = Math.random() * 1000 - 500;
      const angle1 = Math.random() * Math.PI;
      const angle2 = Math.random() * Math.PI;
      
      return {
        input: {
          x1: Math.round(x1 * 100) / 100,
          y1: Math.round(y1 * 100) / 100,
          x2: Math.round(x2 * 100) / 100,
          y2: Math.round(y2 * 100) / 100,
          angle1: Math.round(angle1 * 1000) / 1000,
          angle2: Math.round(angle2 * 1000) / 1000
        },
        description: "Calculate the intersection point using forward intersection"
      };
    `;
    
    return executor.executeGenerator(script, variantIndex, seed);
  }

  /**
   * Generate distance calculation task
   */
  static generateDistanceCalculation(variantIndex, seed) {
    const executor = new SandboxExecutor();
    
    const script = `
      // Generate two points
      const x1 = Math.random() * 1000 - 500;
      const y1 = Math.random() * 1000 - 500;
      const x2 = Math.random() * 1000 - 500;
      const y2 = Math.random() * 1000 - 500;
      
      return {
        input: {
          x1: Math.round(x1 * 100) / 100,
          y1: Math.round(y1 * 100) / 100,
          x2: Math.round(x2 * 100) / 100,
          y2: Math.round(y2 * 100) / 100
        },
        description: "Calculate the distance between the two points"
      };
    `;
    
    return executor.executeGenerator(script, variantIndex, seed);
  }
}

module.exports = {
  SandboxExecutor,
  TaskTemplateHelpers
};

import { WorkflowConfig } from '../models/WorkflowConfig.js';
import { successResponse } from '../utils/apiResponse.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export class ConfigController {
  /**
   * Lists all workflow configurations
   */
  static async listConfigs(req, res, next) {
    try {
      const { workflowType } = req.query;
      const filter = {};
      if (workflowType) filter.workflowType = workflowType.toUpperCase();

      const configs = await WorkflowConfig.find(filter)
        .sort({ workflowType: 1, version: -1 })
        .lean();

      return successResponse(res, configs);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves single configuration by ID
   */
  static async getConfigById(req, res, next) {
    try {
      const { id } = req.params;
      const config = await WorkflowConfig.findById(id).lean();

      if (!config) {
        throw new NotFoundError(`Workflow configuration '${id}' not found`);
      }

      return successResponse(res, config);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Creates a new configuration or new version of existing workflowType
   */
  static async createConfig(req, res, next) {
    try {
      const {
        name,
        description = '',
        workflowType,
        inputSchema,
        stages,
        rules,
        transitions,
        retryPolicy,
        isActive = false
      } = req.body;

      if (!name || !workflowType) {
        throw new ValidationError("Configuration requires 'name' and 'workflowType'");
      }

      const normalizedType = workflowType.toUpperCase();

      // Find highest existing version for this workflowType
      const latest = await WorkflowConfig.findOne({ workflowType: normalizedType })
        .sort({ version: -1 })
        .lean();

      const newVersion = latest ? latest.version + 1 : 1;

      // If marked as active, deactivate other versions of this workflowType
      if (isActive) {
        await WorkflowConfig.updateMany({ workflowType: normalizedType }, { isActive: false });
      }

      const config = new WorkflowConfig({
        name,
        description,
        workflowType: normalizedType,
        version: newVersion,
        inputSchema: inputSchema || latest?.inputSchema,
        stages: stages || latest?.stages,
        rules: rules || latest?.rules || [],
        transitions: transitions || latest?.transitions,
        retryPolicy: retryPolicy || latest?.retryPolicy,
        isActive
      });

      await config.save();
      return successResponse(res, config, 201, `Workflow configuration v${newVersion} created successfully`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Updates an existing configuration
   */
  static async updateConfig(req, res, next) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Do not allow changing workflowType or version directly
      delete updates.workflowType;
      delete updates.version;

      const updated = await WorkflowConfig.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!updated) {
        throw new NotFoundError(`Workflow configuration '${id}' not found`);
      }

      return successResponse(res, updated, 200, 'Workflow configuration updated successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Activates a specific configuration version (and deactivates others for that workflowType)
   */
  static async activateConfig(req, res, next) {
    try {
      const { id } = req.params;
      const target = await WorkflowConfig.findById(id);

      if (!target) {
        throw new NotFoundError(`Workflow configuration '${id}' not found`);
      }

      // Deactivate all configurations for this workflowType
      await WorkflowConfig.updateMany(
        { workflowType: target.workflowType },
        { isActive: false }
      );

      target.isActive = true;
      await target.save();

      return successResponse(
        res,
        target,
        200,
        `Workflow configuration '${target.name}' v${target.version} activated as current default`
      );
    } catch (err) {
      next(err);
    }
  }
}


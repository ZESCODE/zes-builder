import type { LanguageModel } from 'ai';
import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import { logger } from '~/utils/logger';

interface PollinationsModel {
  id: string;
  aliases?: string[];
  category?: string;
  owned_by?: string;
}

interface PollinationsModelsResponse {
  data: PollinationsModel[];
}

export default class PollinationsProvider extends BaseProvider {
  name = 'Pollinations';
  getApiKeyLink = 'https://enter.pollinations.ai';
  labelForGetApiKey = 'Get a Pollinations API key';

  config = {
    baseUrlKey: 'POLLINATIONS_API_BASE_URL',
    baseUrl: 'https://gen.pollinations.ai/v1',
    apiTokenKey: 'POLLINATIONS_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'openai',
      label: 'OpenAI (Pollinations)',
      provider: 'Pollinations',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8000,
    },
    {
      name: 'openai-fast',
      label: 'OpenAI Fast (Pollinations)',
      provider: 'Pollinations',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8000,
    },
    {
      name: 'gemini',
      label: 'Gemini (Pollinations)',
      provider: 'Pollinations',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8000,
    },
    {
      name: 'mistral',
      label: 'Mistral (Pollinations)',
      provider: 'Pollinations',
      maxTokenAllowed: 32000,
      maxCompletionTokens: 8000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: 'POLLINATIONS_API_BASE_URL',
      defaultApiTokenKey: 'POLLINATIONS_API_KEY',
    });

    if (!baseUrl || !apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = (await response.json()) as PollinationsModelsResponse;
      const models = (res.data || []).filter((model) => !model.category || model.category === 'text');

      return models.map((model) => ({
        name: model.id,
        label: model.id,
        provider: this.name,
        maxTokenAllowed: 32000,
        maxCompletionTokens: 8000,
      }));
    } catch (error) {
      logger.error(`${this.name}: Error fetching dynamic models:`, error);
      return [];
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModel {
    const { model, serverEnv, apiKeys, providerSettings } = options;
    const envRecord = this.convertEnvToRecord(serverEnv);

    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: envRecord,
      defaultBaseUrlKey: 'POLLINATIONS_API_BASE_URL',
      defaultApiTokenKey: 'POLLINATIONS_API_KEY',
    });

    if (!baseUrl) {
      throw new Error(`Missing base URL for ${this.name} provider`);
    }

    /*
     * The gateway accepts an empty official key for anonymous usage, but
     * authenticated calls need POLLINATIONS_API_KEY.
     */
    return getOpenAILikeModel(baseUrl, apiKey, model);
  }
}

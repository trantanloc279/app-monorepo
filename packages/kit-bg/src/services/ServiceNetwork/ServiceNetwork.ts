import { uniq } from 'lodash';

import type { EAddressEncodings } from '@onekeyhq/core/src/types';
import {
  backgroundClass,
  backgroundMethod,
} from '@onekeyhq/shared/src/background/backgroundDecorators';
import { getNetworkIdsMap } from '@onekeyhq/shared/src/config/networkIds';
import { getPresetNetworks } from '@onekeyhq/shared/src/config/presetNetworks';
import { appLocale } from '@onekeyhq/shared/src/locale/appLocale';
import { memoizee } from '@onekeyhq/shared/src/utils/cacheUtils';
import type { IServerNetwork } from '@onekeyhq/shared/types';

import { vaultFactory } from '../../vaults/factory';
import {
  getVaultSettings,
  getVaultSettingsAccountDeriveInfo,
} from '../../vaults/settings';
import ServiceBase from '../ServiceBase';

import type {
  IAccountDeriveInfo,
  IAccountDeriveInfoItems,
  IAccountDeriveTypes,
} from '../../vaults/types';

const defaultPinnedNetworkIds = [
  getNetworkIdsMap().btc,
  getNetworkIdsMap().eth,
  getNetworkIdsMap().lightning,
  getNetworkIdsMap().arbitrum,
  getNetworkIdsMap().polygon,
  getNetworkIdsMap().cosmoshub,
];

@backgroundClass()
class ServiceNetwork extends ServiceBase {
  constructor({ backgroundApi }: { backgroundApi: any }) {
    super({ backgroundApi });
  }

  @backgroundMethod()
  async getAllNetworks(): Promise<{ networks: IServerNetwork[] }> {
    // TODO save to simpleDB
    const networks = getPresetNetworks();
    return Promise.resolve({ networks });
  }

  @backgroundMethod()
  async getAllNetworkIds(): Promise<{ networkIds: string[] }> {
    const { networks } = await this.getAllNetworks();
    const networkIds = networks.map((n) => n.id);
    return {
      networkIds,
    };
  }

  @backgroundMethod()
  async getAllNetworkImpls(): Promise<{ impls: string[] }> {
    const { networks } = await this.getAllNetworks();
    const impls = uniq(networks.map((n) => n.impl));
    return {
      impls,
    };
  }

  @backgroundMethod()
  async getNetwork({
    networkId,
    code,
  }: {
    networkId?: string;
    code?: string;
  }): Promise<IServerNetwork> {
    const { networks } = await this.getAllNetworks();
    let network: IServerNetwork | undefined;
    if (!network && networkId) {
      network = networks.find((n) => n.id === networkId);
    }
    if (!network && code) {
      network = networks.find((n) => n.code === code);
    }
    if (!network) {
      throw new Error(
        `getNetwork ERROR: Network not found: ${networkId || ''} ${code || ''}`,
      );
    }
    return network;
  }

  @backgroundMethod()
  async getNetworkSafe({
    networkId,
    code,
  }: {
    networkId?: string;
    code?: string;
  }): Promise<IServerNetwork | undefined> {
    try {
      return await this.getNetwork({ networkId, code });
    } catch (error) {
      return undefined;
    }
  }

  @backgroundMethod()
  async getNetworksByIds({
    networkIds,
  }: {
    networkIds: string[];
  }): Promise<{ networks: IServerNetwork[] }> {
    const { networks } = await this.getAllNetworks();
    return {
      networks: networks.filter((n) => networkIds.includes(n.id)),
    };
  }

  @backgroundMethod()
  async getNetworksByImpls({
    impls,
  }: {
    impls: string[];
  }): Promise<{ networks: IServerNetwork[] }> {
    const { networks } = await this.getAllNetworks();
    return {
      networks: networks.filter((n) => impls.includes(n.impl)),
    };
  }

  @backgroundMethod()
  async getNetworkIdsByImpls({
    impls,
  }: {
    impls: string[];
  }): Promise<{ networkIds: string[] }> {
    const { networks } = await this.getNetworksByImpls({ impls });
    return {
      networkIds: networks.map((n) => n.id),
    };
  }

  @backgroundMethod()
  public async getNetworkByImplListAndChainId(
    implList: string[],
    chainId: string,
  ) {
    const { networks } = await this.getNetworksByImpls({
      impls: implList,
    });
    return networks.find((n) => n.chainId === chainId);
  }

  @backgroundMethod()
  async getVaultSettings({ networkId }: { networkId: string }) {
    const settings = await getVaultSettings({ networkId });
    return settings;
  }

  @backgroundMethod()
  async filterNetworks({
    networks,
    searchKey,
  }: {
    networks: IServerNetwork[];
    searchKey: string;
  }) {
    const key = searchKey.toLowerCase();
    if (key) {
      return networks.filter(
        (o) =>
          o.name.toLowerCase().includes(key) ||
          o.shortname.toLowerCase().includes(key),
      );
    }
    return networks;
  }

  async containsNetwork({
    impls,
    networkId,
  }: {
    impls?: string[];
    networkId: string;
  }) {
    let networkIds: string[];
    if (impls) {
      ({ networkIds } = await this.getNetworkIdsByImpls({ impls }));
    } else {
      ({ networkIds } = await this.getAllNetworkIds());
    }
    return networkIds.includes(networkId);
  }

  @backgroundMethod()
  async getDeriveInfoMapOfNetwork({ networkId }: { networkId: string }) {
    const settings = await this.getVaultSettings({
      networkId,
    });
    // TODO remove ETC config
    return settings.accountDeriveInfo;
  }

  async getDeriveTypeByTemplate({
    networkId,
    template,
  }: {
    networkId: string;
    template: string | undefined;
  }): Promise<{
    deriveType: IAccountDeriveTypes;
    deriveInfo: IAccountDeriveInfo | undefined;
  }> {
    if (!template) {
      return { deriveType: 'default', deriveInfo: undefined };
    }
    const deriveInfoItems = await this.getDeriveInfoItemsOfNetwork({
      networkId,
    });
    const deriveInfo = deriveInfoItems.find(
      (item) => item.item.template === template,
    );
    const deriveType = deriveInfo?.value as IAccountDeriveTypes | undefined;
    return {
      deriveType: deriveType || 'default',
      deriveInfo: deriveInfo?.item,
    };
  }

  async getDeriveTemplateByPath({
    networkId,
    path,
  }: {
    networkId: string;
    path: string;
  }): Promise<string | undefined> {
    const deriveInfoItems = await this.getDeriveInfoItemsOfNetwork({
      networkId,
    });
    const findMap: { [template: string]: number } = {};
    const pathSegments = path.split('/');
    for (const item of deriveInfoItems) {
      const template = item.item.template;
      const templateSegments = template.split('/');
      let matchedCount = 0;
      for (let i = 0; i < pathSegments.length; i += 1) {
        if (pathSegments[i] === templateSegments[i]) {
          matchedCount += 1;
        } else {
          break;
        }
      }
      findMap[template] = matchedCount;
    }

    let findTemplate: string | undefined;
    let findMatchedCount = 0;
    Object.entries(findMap).forEach(([k, v]) => {
      if (v >= findMatchedCount) {
        findTemplate = k;
        findMatchedCount = v;
      }
    });

    return findTemplate;
  }

  @backgroundMethod()
  async isDeriveTypeAvailableForNetwork({
    networkId,
    deriveType,
  }: {
    networkId: string;
    deriveType: IAccountDeriveTypes;
  }): Promise<boolean> {
    const deriveInfoItems = await this.getDeriveInfoItemsOfNetwork({
      networkId,
    });
    return Boolean(deriveInfoItems.find((item) => item.value === deriveType));
  }

  @backgroundMethod()
  async getDeriveInfoItemsOfNetwork({
    networkId,
    enabledItems,
  }: {
    networkId: string | undefined;
    enabledItems?: IAccountDeriveInfo[];
  }): Promise<IAccountDeriveInfoItems[]> {
    if (!networkId) {
      return [];
    }
    const map = await this.getDeriveInfoMapOfNetwork({
      networkId,
    });
    return Object.entries(map)
      .map(([k, v]) => {
        if (
          enabledItems &&
          !enabledItems.find((item) => item.template === v.template)
        ) {
          return null;
        }
        const { desc, subDesc, descI18n } = v;
        let description = desc || subDesc;
        if (descI18n?.id) {
          description = appLocale.intl.formatMessage(
            { id: descI18n?.id },
            descI18n?.data,
          );
        }

        const d: IAccountDeriveInfoItems = {
          item: v,
          description,
          descI18n,
          value: k,
          label:
            (v.labelKey
              ? appLocale.intl.formatMessage({ id: v.labelKey })
              : v.label) || k,
        };
        return d;
      })
      .filter(Boolean);
  }

  @backgroundMethod()
  async getDeriveInfoOfNetwork({
    networkId,
    deriveType,
  }: {
    networkId: string;
    deriveType: IAccountDeriveTypes;
  }): Promise<IAccountDeriveInfo> {
    return getVaultSettingsAccountDeriveInfo({ networkId, deriveType });
  }

  @backgroundMethod()
  async setNetworkSelectorPinnedNetworks({
    networks,
  }: {
    networks: IServerNetwork[];
  }) {
    return this.backgroundApi.simpleDb.networkSelector.setPinnedNetworkIds({
      networkIds: networks.map((o) => o.id),
    });
  }

  @backgroundMethod()
  async getNetworkSelectorPinnedNetworks(): Promise<IServerNetwork[]> {
    const pinnedNetworkIds =
      await this.backgroundApi.simpleDb.networkSelector.getPinnedNetworkIds();
    const networkIds = pinnedNetworkIds ?? defaultPinnedNetworkIds;
    const networkIdsIndex = networkIds.reduce((result, item, index) => {
      result[item] = index;
      return result;
    }, {} as Record<string, number>);
    const resp = await this.getNetworksByIds({ networkIds });
    return resp.networks.sort(
      (a, b) => networkIdsIndex[a.id] - networkIdsIndex[b.id],
    );
  }

  @backgroundMethod()
  async getGlobalDeriveTypeOfNetwork({
    networkId,
  }: {
    networkId: string;
  }): Promise<IAccountDeriveTypes> {
    const currentGlobalDeriveType =
      await this.backgroundApi.simpleDb.accountSelector.getGlobalDeriveType({
        networkId,
      });
    return currentGlobalDeriveType ?? 'default';
  }

  @backgroundMethod()
  async saveGlobalDeriveTypeForNetwork({
    networkId,
    deriveType,
    eventEmitDisabled,
  }: {
    deriveType: IAccountDeriveTypes;
    networkId: string;
    eventEmitDisabled?: boolean | undefined;
  }) {
    const deriveInfoItems = await this.getDeriveInfoItemsOfNetwork({
      networkId,
    });
    if (deriveInfoItems.find((item) => item.value === deriveType)) {
      await this.backgroundApi.simpleDb.accountSelector.saveGlobalDeriveType({
        eventEmitDisabled,
        networkId,
        deriveType,
      });
    }
  }

  async getDeriveTypeByAddressEncoding({
    networkId,
    encoding,
  }: {
    networkId: string;
    encoding: EAddressEncodings;
  }): Promise<IAccountDeriveTypes | undefined> {
    const items = await this.getDeriveInfoItemsOfNetwork({ networkId });
    const deriveInfo = items.find(
      (item) => item.item.addressEncoding === encoding,
    );
    return deriveInfo?.value as IAccountDeriveTypes | undefined;
  }

  async getAccountImportingDeriveTypes({
    networkId,
    input,
    validateAddress,
    validateXpub,
    validatePrivateKey,
    validateXprvt,
    template,
  }: {
    networkId: string;
    input: string;
    validateAddress?: boolean;
    validateXpub?: boolean;
    validateXprvt?: boolean;
    validatePrivateKey?: boolean;
    template: string | undefined;
  }) {
    const { serviceAccount, servicePassword, serviceNetwork } =
      this.backgroundApi;

    const { deriveType: deriveTypeInTpl } =
      await serviceNetwork.getDeriveTypeByTemplate({
        networkId,
        template,
      });
    let deriveTypes: IAccountDeriveTypes[] = [deriveTypeInTpl];

    const validateResult = await serviceAccount.validateGeneralInputOfImporting(
      {
        networkId,
        input: await servicePassword.encodeSensitiveText({ text: input }),
        validateAddress,
        validateXpub,
        validatePrivateKey,
        validateXprvt,
      },
    );
    if (validateResult?.deriveInfoItems?.length) {
      const availableDeriveTypes = (
        await serviceNetwork.getDeriveInfoItemsOfNetwork({
          networkId,
          enabledItems: validateResult.deriveInfoItems,
        })
      ).map((item) => item.value);
      deriveTypes = [
        ...deriveTypes,
        ...(availableDeriveTypes as IAccountDeriveTypes[]),
      ];
    }
    deriveTypes = uniq(deriveTypes);
    return deriveTypes;
  }

  private _getNetworkVaultSettings = memoizee(
    async () => {
      const { networks } = await this.getAllNetworks();
      const result = await Promise.all(
        networks.map(async (network) => {
          const vault = await vaultFactory.getChainOnlyVault({
            networkId: network.id,
          });
          const vaultSetting = await vault.getVaultSettings();
          return {
            network,
            vaultSetting,
          };
        }),
      );
      return result;
    },
    { max: 1 },
  );

  @backgroundMethod()
  async getImportedAccountEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter((o) => o.vaultSetting.importedAccountEnabled)
      .map((o) => o.network);
  }

  @backgroundMethod()
  async getWatchingAccountEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter((o) => o.vaultSetting.watchingAccountEnabled)
      .map((o) => o.network);
  }

  @backgroundMethod()
  async getPublicKeyExportEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter((o) => o.vaultSetting.publicKeyExportEnabled)
      .map((o) => o.network);
  }

  @backgroundMethod()
  async getPublicKeyExportOrWatchingAccountEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter(
        (o) =>
          o.vaultSetting.publicKeyExportEnabled ||
          o.vaultSetting.watchingAccountEnabled,
      )
      .map((o) => ({
        network: o.network,
        publicKeyExportEnabled: o.vaultSetting.publicKeyExportEnabled,
        watchingAccountEnabled: o.vaultSetting.watchingAccountEnabled,
      }));
  }

  @backgroundMethod()
  async getAddressBookEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter((o) => !o.vaultSetting.addressBookDisabled)
      .map((o) => o.network);
  }

  @backgroundMethod()
  async getDappInteractionEnabledNetworks() {
    const settings = await this._getNetworkVaultSettings();
    return settings
      .filter(
        (o) => o.vaultSetting.dappInteractionEnabled && !o.network.isTestnet,
      )
      .map((o) => o.network);
  }
}

export default ServiceNetwork;

///: BEGIN:ONLY_INCLUDE_IF(keyring-snaps)
/* eslint-disable arrow-body-style */
import { MULTICHAIN_ACCOUNT_TYPE_TO_MAINNET } from '../../core/Multichain/constants';
import { RootState } from '../../reducers';
import {
  selectChainId,
  selectEvmChainId,
  selectProviderConfig as selectEvmProviderConfig,
} from '../networkController';
import {
  selectInternalAccounts,
  selectSelectedInternalAccount,
} from '../accountsController';
import { createDeepEqualSelector } from '../util';
import {
  Balance,
  SolScope,
  Transaction as NonEvmTransaction,
} from '@metamask/keyring-api';
import { selectConversionRate } from '../currencyRateController';
import { isMainNet } from '../../util/networks';
import { selectAccountBalanceByChainId } from '../accountTrackerController';
import { selectShowFiatInTestnets } from '../settings';
import { selectIsSolanaTestnetEnabled } from '../featureFlagController/solanaTestnet';
import {
  selectIsEvmNetworkSelected,
  selectSelectedNonEvmNetworkChainId,
  selectSelectedNonEvmNetworkSymbol,
} from '../multichainNetworkController';
import {
  CaipAssetId,
  CaipAssetType,
  parseCaipAssetType,
} from '@metamask/utils';
import BigNumber from 'bignumber.js';
import { InternalAccount } from '@metamask/keyring-internal-api';
import {
  MultichainAssetsControllerState,
  MultichainAssetsRatesControllerState,
  MultichainBalancesControllerState,
} from '@metamask/assets-controllers';
import {
  AVAILABLE_MULTICHAIN_NETWORK_CONFIGURATIONS,
  SupportedCaipChainId,
} from '@metamask/multichain-network-controller';
import { TokenI } from '../../components/UI/Tokens/types';
import { createSelector } from 'reselect';
import { selectSelectedAccountGroupInternalAccounts } from '../multichainAccounts/accountTreeController';

type RawDerived<T> = {
  raw: T | null;
  derived: T | null;
};

/**
 * Helper: ensure string balance presence for non-EVM assets (use '0' for numeric amounts)
 * For EVM hex values elsewhere we used '0x0'; here multichain balances use decimal strings.
 */
function ensureAmountString(amount?: string | null | undefined): string {
  if (amount === undefined || amount === null) return '0';
  return amount;
}

/**
 * Multichain default token selector - returns { raw, derived }
 */
export const selectMultichainDefaultToken = createDeepEqualSelector(
  selectIsEvmNetworkSelected,
  selectEvmProviderConfig,
  selectSelectedNonEvmNetworkSymbol,
  (isEvmSelected, evmProviderConfig, nonEvmTicker): RawDerived<{ symbol: string }> => {
    const raw = {
      isEvmSelected,
      evmProviderConfig,
      nonEvmTicker,
    };
    console.log('[multichain.ts] selectMultichainDefaultToken - raw', raw);
    const symbol = isEvmSelected ? evmProviderConfig.ticker : nonEvmTicker;
    return { raw, derived: { symbol } };
  },
);

/**
 * Is mainnet selector - returns { raw, derived }
 */
export const selectMultichainIsMainnet = createDeepEqualSelector(
  selectIsEvmNetworkSelected,
  selectSelectedInternalAccount,
  selectEvmChainId,
  selectChainId,
  (
    isEvmSelected,
    selectedAccount,
    evmChainId,
    chainId,
  ): RawDerived<boolean> => {
    const raw = { isEvmSelected, selectedAccount, evmChainId, chainId };
    console.log('[multichain.ts] selectMultichainIsMainnet - raw', raw);

    let derived = false;

    if (isEvmSelected) {
      derived = isMainNet(evmChainId);
    } else {
      if (!selectedAccount) {
        derived = false;
      } else {
        const mainnet = (MULTICHAIN_ACCOUNT_TYPE_TO_MAINNET as Record<string, string>)[
          selectedAccount.type
        ];
        derived = chainId === mainnet;
      }
    }

    return { raw, derived };
  },
);

/**
 * selectMultichainBalancesControllerState - raw accessor
 */
const selectMultichainBalancesControllerState = (state: RootState) =>
  state.engine.backgroundState.MultichainBalancesController;

/**
 * selectMultichainBalances - returns { raw, derived }
 */
export const selectMultichainBalances = createDeepEqualSelector(
  selectMultichainBalancesControllerState,
  (multichainBalancesControllerState): RawDerived<MultichainBalancesControllerState['balances']> => {
    const raw = multichainBalancesControllerState?.balances ?? null;
    console.log('[multichain.ts] selectMultichainBalances - raw', raw);
    const derived = raw ?? {};
    return { raw, derived };
  },
);

/**
 * selectMultichainShouldShowFiat - returns { raw, derived:boolean }
 */
export const selectMultichainShouldShowFiat = createDeepEqualSelector(
  selectMultichainIsMainnet,
  selectIsEvmNetworkSelected,
  selectShowFiatInTestnets,
  (multichainIsMainnetWrapper, isEvmSelected, shouldShowFiatOnTestnets): RawDerived<boolean> => {
    const raw = {
      multichainIsMainnetRaw: multichainIsMainnetWrapper?.raw,
      multichainIsMainnetDerived: multichainIsMainnetWrapper?.derived,
      isEvmSelected,
      shouldShowFiatOnTestnets,
    };
    console.log('[multichain.ts] selectMultichainShouldShowFiat - raw', raw);

    const multichainIsMainnet = multichainIsMainnetWrapper?.derived ?? false;
    const isTestnet = !multichainIsMainnet;

    const derived = isEvmSelected
      ? isTestnet
        ? Boolean(shouldShowFiatOnTestnets)
        : true
      : multichainIsMainnet || (isTestnet && Boolean(shouldShowFiatOnTestnets));

    return { raw, derived };
  },
);

/**
 * Helper: get non-EVM cached balance for an internal account
 * Keep raw value and return derived (amount string or undefined)
 */
const getNonEvmCachedBalance = (
  internalAccount: InternalAccount,
  multichainBalances: MultichainBalancesControllerState['balances'],
  nonEvmChainId: SupportedCaipChainId,
): string | undefined => {
  const asset =
    AVAILABLE_MULTICHAIN_NETWORK_CONFIGURATIONS[nonEvmChainId].nativeCurrency;
  const balancesForAccount = multichainBalances?.[internalAccount.id];
  const balanceOfAsset = balancesForAccount?.[asset];
  return balanceOfAsset?.amount ?? undefined;
};

/**
 * selectNonEvmCachedBalance - returns { raw, derived }
 */
export const selectNonEvmCachedBalance = createDeepEqualSelector(
  selectSelectedInternalAccount,
  selectMultichainBalances,
  selectSelectedNonEvmNetworkChainId,
  (selectedInternalAccountWrapper, multichainBalancesWrapper, nonEvmChainId): RawDerived<string | undefined> => {
    const raw = {
      selectedInternalAccountRaw: selectedInternalAccountWrapper?.raw,
      selectedInternalAccountDerived: selectedInternalAccountWrapper?.derived,
      multichainBalancesRaw: multichainBalancesWrapper?.raw,
      multichainBalancesDerived: multichainBalancesWrapper?.derived,
      nonEvmChainId,
    };
    console.log('[multichain.ts] selectNonEvmCachedBalance - raw', raw);

    const selectedInternalAccount = selectedInternalAccountWrapper?.derived ?? null;
    const multichainBalances = multichainBalancesWrapper?.derived ?? {};

    if (!selectedInternalAccount) {
      return { raw, derived: undefined };
    }

    const derived = getNonEvmCachedBalance(
      selectedInternalAccount as InternalAccount,
      multichainBalances as MultichainBalancesControllerState['balances'],
      nonEvmChainId as SupportedCaipChainId,
    );

    return { raw, derived };
  },
);

/**
 * selectMultichainSelectedAccountCachedBalance - wrapper that returns selected native balance depending on EVM vs Non-EVM
 */
export const selectMultichainSelectedAccountCachedBalance =
  createDeepEqualSelector(
    selectIsEvmNetworkSelected,
    selectAccountBalanceByChainId,
    selectNonEvmCachedBalance,
    (isEvmSelected, accountBalanceByChainIdWrapper, nonEvmCachedBalanceWrapper): RawDerived<string | undefined> => {
      const raw = {
        isEvmSelected,
        accountBalanceByChainIdRaw: accountBalanceByChainIdWrapper?.raw,
        accountBalanceByChainIdDerived: accountBalanceByChainIdWrapper?.derived,
        nonEvmCachedBalanceRaw: nonEvmCachedBalanceWrapper?.raw,
        nonEvmCachedBalanceDerived: nonEvmCachedBalanceWrapper?.derived,
      };
      console.log('[multichain.ts] selectMultichainSelectedAccountCachedBalance - raw', raw);

      const accountBalanceByChainId = accountBalanceByChainIdWrapper?.derived ?? null;
      const nonEvmCachedBalance = nonEvmCachedBalanceWrapper?.derived ?? undefined;

      const derived = isEvmSelected
        ? (accountBalanceByChainId?.balance ?? '0x0')
        : nonEvmCachedBalance;

      return { raw, derived };
    },
  );

/**
 * selectMultichainCoinRates - simple accessor (returns raw+derived)
 */
export function selectMultichainCoinRates(state: RootState): RawDerived<any> {
  const raw = state.engine.backgroundState.RatesController.rates ?? null;
  console.log('[multichain.ts] selectMultichainCoinRates - raw', raw);
  const derived = raw ?? {};
  return { raw, derived };
}

/**
 * selectMultichainConversionRate
 */
export const selectMultichainConversionRate = createDeepEqualSelector(
  selectIsEvmNetworkSelected,
  selectConversionRate,
  selectMultichainCoinRates,
  selectSelectedNonEvmNetworkSymbol,
  (
    isEvmSelected,
    evmConversionRate,
    multichaincCoinRatesWrapper,
    nonEvmTicker,
  ): RawDerived<number | undefined> => {
    const raw = {
      isEvmSelected,
      evmConversionRate,
      multichaincCoinRatesRaw: multichaincCoinRatesWrapper?.raw,
      multichaincCoinRatesDerived: multichaincCoinRatesWrapper?.derived,
      nonEvmTicker,
    };
    console.log('[multichain.ts] selectMultichainConversionRate - raw', raw);

    const multichaincCoinRates = multichaincCoinRatesWrapper?.derived ?? {};
    let derived: number | undefined;

    if (isEvmSelected) {
      derived = evmConversionRate;
    } else {
      derived = nonEvmTicker
        ? multichaincCoinRates?.[nonEvmTicker.toLowerCase()]?.conversionRate
        : undefined;
    }

    return { raw, derived };
  },
);

/**
 * selectMultichainTransactionsControllerState
 */
const selectMultichainTransactionsControllerState = (state: RootState) =>
  state.engine.backgroundState.MultichainTransactionsController;

/**
 * selectMultichainTransactions - returns { raw, derived }
 */
export const selectMultichainTransactions = createDeepEqualSelector(
  selectMultichainTransactionsControllerState,
  (multichainTransactionsControllerState): RawDerived<
    MultichainTransactionsControllerState['nonEvmTransactions']
  > => {
    const raw = multichainTransactionsControllerState?.nonEvmTransactions ?? null;
    console.log('[multichain.ts] selectMultichainTransactions - raw', raw);
    const derived = raw ?? {};
    return { raw, derived };
  },
);

/**
 * selectMultichainAssets and selectMultichainAssetsMetadata accessors
 * NOTE: these are functions in original file — keep as functions but wrap raw/derived returns
 */
export function selectMultichainAssets(state: RootState): RawDerived<MultichainAssetsControllerState['accountsAssets']> {
  const raw = state.engine.backgroundState.MultichainAssetsController.accountsAssets ?? null;
  console.log('[multichain.ts] selectMultichainAssets - raw', raw);
  const derived = raw ?? {};
  return { raw, derived };
}

export function selectMultichainAssetsMetadata(state: RootState): RawDerived<MultichainAssetsControllerState['assetsMetadata']> {
  const raw = state.engine.backgroundState.MultichainAssetsController.assetsMetadata ?? null;
  console.log('[multichain.ts] selectMultichainAssetsMetadata - raw', raw);
  const derived = raw ?? {};
  return { raw, derived };
}

/**
 * selectMultichainAssetsRates state accessor
 */
function selectMultichainAssetsRatesState(state: RootState) {
  return state.engine.backgroundState.MultichainAssetsRatesController
    .conversionRates;
}

export const selectMultichainAssetsRates = createDeepEqualSelector(
  selectMultichainAssetsRatesState,
  (conversionRates): RawDerived<MultichainAssetsRatesControllerState['conversionRates']> => {
    const raw = conversionRates ?? null;
    console.log('[multichain.ts] selectMultichainAssetsRates - raw', raw);
    const derived = raw ?? {};
    return { raw, derived };
  },
  { devModeChecks: { identityFunctionCheck: 'never' } },
);

/**
 * selectMultichainHistoricalPrices accessor
 */
export function selectMultichainHistoricalPrices(state: RootState): RawDerived<any> {
  const raw = state.engine.backgroundState.MultichainAssetsRatesController.historicalPrices ?? null;
  console.log('[multichain.ts] selectMultichainHistoricalPrices - raw', raw);
  const derived = raw ?? {};
  return { raw, derived };
}

/**
 * selectMultichainTokenListForAccountId
 * Returns raw (balances, assets, assetsMetadata, assetsRates, requested accountId) and derived token list
 */
export const selectMultichainTokenListForAccountId = createDeepEqualSelector(
  selectMultichainBalances,
  // Note: these two are functions, adapt usage to derived values
  (_state: RootState) => selectMultichainAssets(_state).derived,
  (_state: RootState) => selectMultichainAssetsMetadata(_state).derived,
  selectMultichainAssetsRates,
  selectSelectedNonEvmNetworkChainId,
  (_: RootState, accountId: string | undefined) => accountId,
  (
    multichainBalancesWrapper,
    assetsDerived,
    assetsMetadataDerived,
    assetsRatesWrapper,
    nonEvmNetworkChainId,
    accountId,
  ): RawDerived<TokenI[]> => {
    const raw = {
      multichainBalancesRaw: multichainBalancesWrapper?.raw,
      multichainBalancesDerived: multichainBalancesWrapper?.derived,
      assets: assetsDerived ?? {},
      assetsMetadata: assetsMetadataDerived ?? {},
      assetsRatesRaw: assetsRatesWrapper?.raw,
      assetsRatesDerived: assetsRatesWrapper?.derived,
      nonEvmNetworkChainId,
      accountId,
    };
    console.log('[multichain.ts] selectMultichainTokenListForAccountId - raw', raw);

    if (!accountId) {
      return { raw, derived: [] };
    }

    const assetIds = (assetsDerived as any)?.[accountId] || [];
    const balances = (multichainBalancesWrapper?.derived as any)?.[accountId] || {};

    const tokens: TokenI[] = [];

    for (const assetId of assetIds) {
      const { chainId, assetNamespace } = parseCaipAssetType(assetId as CaipAssetId);

      if (chainId !== nonEvmNetworkChainId) {
        continue;
      }

      const isNative = assetNamespace === 'slip44';
      const balance = balances?.[assetId] || { amount: undefined, unit: '' };

      const rate = (assetsRatesWrapper?.derived as any)?.[assetId]?.rate || '0';
      const balanceInFiat = balance.amount
        ? new BigNumber(balance.amount).times(rate)
        : undefined;

      const assetMetadataFallback = {
        name: balance.unit || '',
        symbol: balance.unit || '',
        fungible: true,
        units: [{ name: assetId, symbol: balance.unit || '', decimals: 0 }],
      };

      const metadata = (assetsMetadataDerived as any)?.[assetId] || assetMetadataFallback;
      const decimals = metadata.units[0]?.decimals || 0;

      tokens.push({
        name: metadata?.name ?? '',
        address: assetId,
        symbol: metadata?.symbol ?? '',
        image: metadata?.iconUrl,
        logo: metadata?.iconUrl,
        decimals,
        chainId,
        isNative,
        // ensure default amount string for empty balances
        balance: balance.amount ?? '0',
        secondary: balanceInFiat ? balanceInFiat.toString() : undefined,
        string: '',
        balanceFiat: balanceInFiat ? balanceInFiat.toString() : undefined,
        isStakeable: false,
        aggregators: [],
        isETH: false,
        ticker: metadata.symbol,
      });
    }

    return { raw, derived: tokens };
  },
);

/**
 * selectMultichainTokenListForAccountAnyChain
 */
export const selectMultichainTokenListForAccountAnyChain = createDeepEqualSelector(
  selectMultichainBalances,
  (_state: RootState) => selectMultichainAssets(_state).derived,
  (_state: RootState) => selectMultichainAssetsMetadata(_state).derived,
  selectMultichainAssetsRates,
  (_: RootState, account: InternalAccount | undefined) => account,
  (
    multichainBalancesWrapper,
    assetsDerived,
    assetsMetadataDerived,
    assetsRatesWrapper,
    account,
  ): RawDerived<TokenI[]> => {
    const raw = {
      multichainBalancesRaw: multichainBalancesWrapper?.raw,
      multichainBalancesDerived: multichainBalancesWrapper?.derived,
      assets: assetsDerived ?? {},
      assetsMetadata: assetsMetadataDerived ?? {},
      assetsRatesRaw: assetsRatesWrapper?.raw,
      assetsRatesDerived: assetsRatesWrapper?.derived,
      account,
    };
    console.log('[multichain.ts] selectMultichainTokenListForAccountAnyChain - raw', raw);

    if (!account) {
      return { raw, derived: [] };
    }

    const accountId = account.id;
    const assetIds = (assetsDerived as any)?.[accountId] || [];
    const balances = (multichainBalancesWrapper?.derived as any)?.[accountId] || {};

    const tokens: TokenI[] = [];

    for (const assetId of assetIds) {
      const { chainId, assetNamespace } = parseCaipAssetType(assetId as CaipAssetId);

      const isNative = assetNamespace === 'slip44';
      const balance = balances?.[assetId] || { amount: undefined, unit: '' };
      const rate = (assetsRatesWrapper?.derived as any)?.[assetId]?.rate || '0';
      const balanceInFiat = balance.amount
        ? new BigNumber(balance.amount).times(rate)
        : undefined;

      const assetMetadataFallback = {
        name: balance.unit || '',
        symbol: balance.unit || '',
        fungible: true,
        units: [{ name: assetId, symbol: balance.unit || '', decimals: 0 }],
      };

      const metadata = (assetsMetadataDerived as any)?.[assetId] || assetMetadataFallback;
      const decimals = metadata.units[0]?.decimals || 0;

      tokens.push({
        name: metadata?.name ?? '',
        address: assetId,
        symbol: metadata?.symbol ?? '',
        image: metadata?.iconUrl,
        logo: metadata?.iconUrl,
        decimals,
        chainId,
        isNative,
        balance: balance.amount ?? '0',
        secondary: balanceInFiat ? balanceInFiat.toString() : undefined,
        string: '',
        balanceFiat: balanceInFiat ? balanceInFiat.toString() : undefined,
        isStakeable: false,
        aggregators: [],
        isETH: false,
        ticker: metadata.symbol,
        accountType: account.type,
      });
    }

    return { raw, derived: tokens };
  },
);

/**
 * Aggregation helpers & types
 */
export interface MultichainNetworkAggregatedBalance {
  totalNativeTokenBalance: Balance | undefined;
  totalBalanceFiat: number | undefined;
  tokenBalances: Record<string, Balance> | undefined;
  fiatBalances: Record<CaipAssetType, string> | undefined;
}

/**
 * getMultichainNetworkAggregatedBalance
 * This function is pure and returns raw / derived structures are built by callers
 */
export const getMultichainNetworkAggregatedBalance = (
  account: InternalAccount,
  multichainBalances: MultichainBalancesControllerState['balances'],
  multichainAssets: MultichainAssetsControllerState['accountsAssets'],
  multichainAssetsRates: MultichainAssetsRatesControllerState['conversionRates'],
): MultichainNetworkAggregatedBalance => {
  const assetIds = multichainAssets?.[account.id] || [];
  const balances = multichainBalances?.[account.id] || {};

  // Default values for native token
  let totalNativeTokenBalance: Balance | undefined;
  let totalBalanceFiat: BigNumber | undefined;
  const fiatBalances: Record<string, string> = {};

  for (const assetId of assetIds) {
    const { chainId } = parseCaipAssetType(assetId);
    const nativeAssetId =
      AVAILABLE_MULTICHAIN_NETWORK_CONFIGURATIONS[
        chainId as SupportedCaipChainId
      ]?.nativeCurrency;

    const balance = balances[assetId] || { amount: '0', unit: '' };

    // Safely handle undefined rate
    const rate = multichainAssetsRates?.[assetId]?.rate;
    const balanceInFiat =
      balance.amount && rate
        ? new BigNumber(balance.amount).times(rate)
        : new BigNumber(0);
    fiatBalances[assetId] = balanceInFiat.toString();

    // If the asset is the native asset of the chain, set it as total nativ

import {
  AccountId,
  AccountsControllerState,
} from '@metamask/accounts-controller';
import { captureException } from '@sentry/react-native';
import { createSelector } from 'reselect';
import { RootState } from '../reducers';
import { createDeepEqualSelector } from './util';
import { selectFlattenedKeyringAccounts } from './keyringController';
import {
  BtcMethod,
  EthMethod,
  SolAccountType,
  SolMethod,
  isEvmAccountType,
} from '@metamask/keyring-api';
import { InternalAccount } from '@metamask/keyring-internal-api';
import {
  getFormattedAddressFromInternalAccount,
  isSolanaAccount,
} from '../core/Multichain/utils';
import { CaipAccountId, CaipChainId, parseCaipChainId } from '@metamask/utils';
import { areAddressesEqual, toFormattedAddress } from '../util/address';
import { anyScopesMatch } from '../components/hooks/useAccountGroupsForPermissions/utils';

export type InternalAccountWithCaipAccountId = InternalAccount & {
  caipAccountId: CaipAccountId;
};

/**
 * Sélecteur principal du AccountsController dans le store Redux.
 * On y ajoute un log pour les données brutes afin de faciliter le debug.
 */
export const selectAccountsControllerState = (state: RootState) => {
  const rawState = state.engine.backgroundState.AccountsController;
  console.log('[AccountsController] Raw Redux State:', rawState);
  return rawState;
};

/**
 * Retourne les comptes internes par ID, avec log des données brutes.
 */
export const selectInternalAccountsById = createDeepEqualSelector(
  selectAccountsControllerState,
  (accountControllerState): Record<AccountId, InternalAccount> => {
    const internalAccounts = accountControllerState.internalAccounts.accounts;
    console.log('[AccountsController] Internal Accounts (raw):', internalAccounts);
    return internalAccounts;
  },
);

/**
 * Retourne les comptes internes triés selon l’ordre du KeyringController.
 */
export const selectInternalAccounts = createDeepEqualSelector(
  selectAccountsControllerState,
  selectFlattenedKeyringAccounts,
  (accountControllerState, orderedKeyringAccounts): InternalAccount[] => {
    const keyringAccountsMap = new Map(
      orderedKeyringAccounts.map((account, index) => [
        toFormattedAddress(account),
        index,
      ]),
    );

    const sortedAccounts = Object.values(
      accountControllerState.internalAccounts.accounts,
    ).sort(
      (a, b) =>
        (keyringAccountsMap.get(toFormattedAddress(a.address)) || 0) -
        (keyringAccountsMap.get(toFormattedAddress(b.address)) || 0),
    );

    console.log('[AccountsController] Sorted Accounts:', sortedAccounts);
    return sortedAccounts;
  },
);

/**
 * Retourne uniquement les comptes EVM internes.
 */
export const selectInternalEvmAccounts = createSelector(
  selectInternalAccounts,
  (accounts) => {
    const evmAccounts = accounts.filter((account) => isEvmAccountType(account.type));
    console.log('[AccountsController] EVM Accounts:', evmAccounts);
    return evmAccounts;
  },
);

/**
 * Retourne les comptes internes avec un identifiant CAIP complet.
 */
export const selectInternalAccountsWithCaipAccountId = createDeepEqualSelector(
  selectInternalAccounts,
  (accounts): InternalAccountWithCaipAccountId[] => {
    const mapped = accounts.map((account) => {
      const { namespace, reference } = parseCaipChainId(account.scopes[0]);
      return {
        ...account,
        caipAccountId: `${namespace}:${reference}:${account.address}`,
      };
    });
    console.log('[AccountsController] Accounts with CAIP ID:', mapped);
    return mapped;
  },
);

/**
 * Retourne le compte interne actuellement sélectionné.
 */
export const selectSelectedInternalAccount = createDeepEqualSelector(
  selectAccountsControllerState,
  (
    accountsControllerState: AccountsControllerState,
  ): InternalAccount | undefined => {
    const accountId = accountsControllerState.internalAccounts.selectedAccount;
    const account =
      accountsControllerState.internalAccounts.accounts[accountId];

    console.log('[AccountsController] Selected Account ID:', accountId);
    console.log('[AccountsController] Selected Account (raw):', account);

    if (!account) {
      const err = new Error(
        `selectSelectedInternalAccount: Account with ID ${accountId} not found.`,
      );
      captureException(err);
      return undefined;
    }
    return account;
  },
);

export const selectSelectedInternalAccountId = createSelector(
  selectSelectedInternalAccount,
  (account): string | undefined => account?.id,
);

/**
 * Trie les comptes internes par date de dernière sélection.
 */
export const selectOrderedInternalAccountsByLastSelected = createSelector(
  selectAccountsControllerState,
  (accountsControllerState) => {
    const accounts = accountsControllerState.internalAccounts.accounts;
    const sorted = Object.values(accounts).sort((a, b) => {
      const aLastSelected = a.metadata?.lastSelected || 0;
      const bLastSelected = b.metadata?.lastSelected || 0;
      return bLastSelected - aLastSelected;
    });
    console.log('[AccountsController] Ordered by Last Selected:', sorted);
    return sorted;
  },
);

/**
 * Récupère un compte interne à partir de son adresse.
 */
export const getMemoizedInternalAccountByAddress = createDeepEqualSelector(
  [selectInternalAccounts, (_state, address) => address],
  (internalAccounts, address) => {
    const found = internalAccounts.find((account) =>
      areAddressesEqual(account.address, address),
    );
    console.log('[AccountsController] Account by address:', address, found);
    return found;
  },
);

/**
 * Dernier compte EVM sélectionné.
 */
export const selectLastSelectedEvmAccount = createSelector(
  selectOrderedInternalAccountsByLastSelected,
  (accounts) => {
    const found = accounts.find((account) => account.type === 'eip155:eoa');
    console.log('[AccountsController] Last Selected EVM Account:', found);
    return found;
  },
);

/**
 * Dernier compte Solana sélectionné.
 */
export const selectLastSelectedSolanaAccount = createSelector(
  selectOrderedInternalAccountsByLastSelected,
  (accounts) => {
    const found = accounts.find((account) => account.type === SolAccountType.DataAccount);
    console.log('[AccountsController] Last Selected Solana Account:', found);
    return found;
  },
);

export const selectSelectedInternalAccountFormattedAddress =
  createDeepEqualSelector(selectSelectedInternalAccount, (account) => {
    const formatted = account?.address
      ? getFormattedAddressFromInternalAccount(account)
      : undefined;
    console.log('[AccountsController] Formatted Selected Address:', formatted);
    return formatted;
  });

export const selectPreviouslySelectedEvmAccount = createDeepEqualSelector(
  selectInternalAccounts,
  (accounts) => {
    const evmAccounts = accounts.filter((account) =>
      isEvmAccountType(account.type),
    );

    if (evmAccounts.length === 0) {
      return undefined;
    }

    const previouslySelectedEvmAccount = [...evmAccounts].sort((a, b) => {
      const aTimestamp = a?.metadata?.lastSelected || 0;
      const bTimestamp = b?.metadata?.lastSelected || 0;
      return bTimestamp - aTimestamp;
    })[0];

    console.log('[AccountsController] Previously Selected EVM Account:', previouslySelectedEvmAccount);
    return previouslySelectedEvmAccount;
  },
);

export const selectSelectedInternalAccountAddress = createSelector(
  selectSelectedInternalAccount,
  (account) => {
    const selectedAddress = account?.address;
    console.log('[AccountsController] Selected Account Address:', selectedAddress);
    return selectedAddress || undefined;
  },
);

export const selectCanSignTransactions = createSelector(
  selectSelectedInternalAccount,
  (selectedAccount) => {
    const canSign =
      (selectedAccount?.methods?.includes(EthMethod.SignTransaction) ||
        selectedAccount?.methods?.includes(SolMethod.SignTransaction) ||
        selectedAccount?.methods?.includes(SolMethod.SignMessage) ||
        selectedAccount?.methods?.includes(SolMethod.SendAndConfirmTransaction) ||
        selectedAccount?.methods?.includes(SolMethod.SignAndSendTransaction) ||
        selectedAccount?.methods?.includes(BtcMethod.SignPsbt)) ??
      false;
    console.log('[AccountsController] Can Sign Transactions:', canSign);
    return canSign;
  },
);

export const selectHasCreatedSolanaMainnetAccount = createSelector(
  selectInternalAccounts,
  (accounts) => {
    const hasSolana = accounts.some((account) => isSolanaAccount(account));
    console.log('[AccountsController] Has Solana Mainnet Account:', hasSolana);
    return hasSolana;
  },
);

///: BEGIN:ONLY_INCLUDE_IF(keyring-snaps)
export const selectSolanaAccountAddress = createSelector(
  selectInternalAccounts,
  (accounts) => {
    const solanaAddr = accounts.find((account) => isSolanaAccount(account))?.address;
    console.log('[AccountsController] Solana Account Address:', solanaAddr);
    return solanaAddr;
  },
);

export const selectSolanaAccount = createSelector(
  selectInternalAccounts,
  (accounts) => {
    const solanaAcc = accounts.find((account) => isSolanaAccount(account));
    console.log('[AccountsController] Solana Account:', solanaAcc);
    return solanaAcc;
  },
);
///: END:ONLY_INCLUDE_IF

export const selectInternalAccountsByScope = createDeepEqualSelector(
  [
    selectInternalAccountsById,
    (_state: RootState, scope: CaipChainId) => scope,
  ],
  (
    accountsMap: Record<AccountId, InternalAccount>,
    scope: CaipChainId,
  ): InternalAccount[] => {
    const accounts = Object.values(accountsMap);
    const filtered = accounts.filter(
      (account) =>
        Array.isArray(account.scopes) && anyScopesMatch(account.scopes, scope),
    );
    console.log('[AccountsController] Accounts by Scope:', scope, filtered);
    return filtered;
  },
);

export const selectInternalAccountByAddresses = createDeepEqualSelector(
  [selectInternalAccountsById],
  (accountsMap) =>
    (addresses: string[]): InternalAccount[] => {
      const accountsByLowerCaseAddress = new Map<string, InternalAccount>();
      for (const account of Object.values(accountsMap)) {
        accountsByLowerCaseAddress.set(account.address.toLowerCase(), account);
      }
      const result = addresses
        .map((address) => accountsByLowerCaseAddress.get(address.toLowerCase()))
        .filter((account): account is InternalAccount => account !== undefined);
      console.log('[AccountsController] Accounts by Addresses:', addresses, result);
      return result;
    },
);

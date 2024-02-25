import { useEffect, useState } from 'react';
import { useToastTxSuccess } from 'src/components/notifications/TxSuccessToast';
import { useToastError } from 'src/components/notifications/useToastError';
import { capitalizeFirstLetter } from 'src/utils/strings';
import { TransactionReceipt } from 'viem';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

// TODO force chain switch to celo mainnet before sending txs
export function useWriteContractWithReceipt(
  description: string,
  onSuccess?: (receipt: TransactionReceipt) => any,
  showTxSuccessToast = false,
) {
  const {
    data: hash,
    error: writeError,
    isError: isWriteError,
    isPending,
    writeContract,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: waitError,
    isError: isWaitError,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
    pollingInterval: 1000,
  });

  useToastError(
    writeError,
    `Error sending ${description} transaction, please check your wallet balance & settings.`,
  );
  useToastError(
    waitError,
    `Error confirming ${description} transaction, please ensure the transaction is valid.`,
  );
  useToastTxSuccess({
    isConfirmed,
    txHash: hash,
    message: `${capitalizeFirstLetter(description)} transaction is confirmed!`,
    enabled: showTxSuccessToast,
  });

  // Run onSuccess when tx is confirmed
  // Some extra state is needed to ensure this only runs once per tx
  const [hasRunOnSuccess, setHasRunOnSuccess] = useState(false);
  useEffect(() => {
    if (hash && receipt && isConfirmed && !hasRunOnSuccess && onSuccess) {
      setHasRunOnSuccess(true);
      onSuccess(receipt);
    }
  }, [hash, receipt, isConfirmed, hasRunOnSuccess, onSuccess]);
  useEffect(() => {
    if (!hash || !receipt || !isConfirmed) setHasRunOnSuccess(false);
  }, [hash, receipt, isConfirmed]);

  return {
    hash,
    isError: isWriteError || isWaitError,
    isLoading: isPending || isConfirming,
    isConfirmed,
    writeContract,
  };
}

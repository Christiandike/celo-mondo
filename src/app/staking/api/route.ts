import { electionABI } from '@celo/abis';
import { fornoRpcUrl } from 'src/config/config';
import { Addresses } from 'src/config/contracts';
import { ADDRESS_REGEX, TX_HASH_REGEX, eqAddress } from 'src/utils/addresses';
import { logger } from 'src/utils/logger';
import { errorToString } from 'src/utils/strings';
import { createPublicClient, createWalletClient, decodeEventLog, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { z } from 'zod';

const StakeActivationRequestSchema = z.object({
  address: z.string().regex(ADDRESS_REGEX),
  transactionHash: z.string().regex(TX_HASH_REGEX),
});

type StakeActivationRequest = z.infer<typeof StakeActivationRequestSchema>;

export async function POST(request: Request) {
  logger.debug('Stake activation request received');
  let activationRequest: StakeActivationRequest;
  try {
    const body = await request.json();
    activationRequest = StakeActivationRequestSchema.parse(body);
  } catch (error) {
    logger.warn('Request validation error', error);
    return new Response('Invalid stake activation request', {
      status: 400,
    });
  }

  try {
    const { address, transactionHash } = activationRequest;
    logger.debug(`Attempting activation for address ${address} with tx ${transactionHash}`);
    const activationTxHash = await activateStake(activationRequest);
    return new Response(
      `Stake activation successful for ${address}. Tx hash: ${activationTxHash}`,
      {
        status: 200,
      },
    );
  } catch (error) {
    logger.error('Stake activation error', error);
    return new Response(`Unable to auto-activate stake: ${errorToString(error)}`, {
      status: 500,
    });
  }
}

async function activateStake(request: StakeActivationRequest) {
  const address = request.address as HexString;
  const transactionHash = request.transactionHash as HexString;

  const client = createPublicClient({ chain: celo, transport: http(fornoRpcUrl) });

  const transaction = await client.getTransactionReceipt({ hash: transactionHash });
  if (!eqAddress(transaction.from, address))
    throw new Error('Tx sender and request address do not match');
  if (!transaction.to || !eqAddress(transaction.to, Addresses.Election))
    throw new Error('Tx not to election contract');

  const block = await client.getBlock({ blockNumber: transaction.blockNumber });
  const timePassed = Date.now() - Number(block.timestamp) * 1000;
  if (timePassed > 3 * 24 * 60 * 60 * 1000) throw new Error('Transaction is too old');

  const log = transaction.logs[0];
  const { eventName, args } = decodeEventLog({
    abi: electionABI,
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  if (eventName !== 'ValidatorGroupVoteCast') throw new Error('Transaction is not a stake vote');
  if (!eqAddress(args.account, address))
    throw new Error('Transaction staker does not match request');

  const group = args.group;
  const hasActivatable = await client.readContract({
    address: Addresses.Election,
    abi: electionABI,
    functionName: 'hasActivatablePendingVotes',
    args: [address, group],
  });
  if (!hasActivatable) throw new Error('Stake is not activatable');

  const walletClient = getWalletClient();

  logger.debug(`Sending activation tx on behalf of ${address}`);
  const activationTxHash = await walletClient.writeContract({
    address: Addresses.Election,
    abi: electionABI,
    functionName: 'activateForAccount',
    args: [group, address],
  });
  logger.debug(`Activation tx confirmed: ${activationTxHash}`);
  return activationTxHash;
}

function getWalletClient() {
  const privateKey = process.env.STAKE_ACTIVATION_PRIVATE_KEY as HexString;
  if (!privateKey) throw new Error('No private key set for staking activation');
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain: celo, transport: http(fornoRpcUrl) });
}

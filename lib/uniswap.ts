import { ethers, BrowserProvider, Contract } from "ethers";

// Sepolia Uniswap V2 Router
const ROUTER_ADDRESS = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
// Sepolia WETH
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; // Standard Sepolia WETH

const ROUTER_ABI = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
    "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)",
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
];

export const getRouterContract = (provider: BrowserProvider | ethers.JsonRpcProvider) => {
    return new Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
};

export const getErc20Contract = (address: string, provider: BrowserProvider | ethers.JsonRpcProvider) => {
    return new Contract(address, ERC20_ABI, provider);
};

// --- Read Functions ---

export const getDexQuoteBuy = async (
    provider: BrowserProvider | ethers.JsonRpcProvider,
    tokenAddress: string,
    ethAmountWei: bigint
): Promise<bigint> => {
    if (ethAmountWei === 0n) return 0n;
    try {
        const router = getRouterContract(provider);
        const path = [WETH_ADDRESS, tokenAddress];
        const amounts = await router.getAmountsOut(ethAmountWei, path);
        return amounts[1]; // Token amount out
    } catch (e) {
        // Swallow router reverts (e.g. missing pool / low liquidity) and return 0 for UI
        return 0n;
    }
};

// Quote: how much ETH is needed to buy a given amount of tokens (exact out),
// using Uniswap V2 `getAmountsIn`. Returns 0n when the pool is missing or reverts.
export const getDexQuoteBuyExactOut = async (
    provider: BrowserProvider | ethers.JsonRpcProvider,
    tokenAddress: string,
    tokenAmountWei: bigint,
): Promise<bigint> => {
    if (tokenAmountWei === 0n) return 0n;
    try {
        const router = getRouterContract(provider);
        const path = [WETH_ADDRESS, tokenAddress];
        const amounts = await router.getAmountsIn(tokenAmountWei, path);
        return amounts[0]; // ETH amount in
    } catch (_e) {
        // Pool not initialized / insufficient liquidity, treat as no quote
        return 0n;
    }
};

export const getDexQuoteSell = async (
    provider: BrowserProvider | ethers.JsonRpcProvider,
    tokenAddress: string,
    tokenAmountWei: bigint
): Promise<bigint> => {
    if (tokenAmountWei === 0n) return 0n;
    try {
        const router = getRouterContract(provider);
        const path = [tokenAddress, WETH_ADDRESS];
        const amounts = await router.getAmountsOut(tokenAmountWei, path);
        return amounts[1]; // ETH amount out
    } catch (e) {
        // Swallow router reverts; UI will treat 0n as "no quote / no liquidity"
        return 0n;
    }
};

export const checkAllowance = async (
    provider: BrowserProvider,
    tokenAddress: string,
    owner: string,
    spender: string = ROUTER_ADDRESS
): Promise<bigint> => {
    const token = getErc20Contract(tokenAddress, provider);
    return await token.allowance(owner, spender);
};

// --- Write Functions ---

export const approveToken = async (
    provider: BrowserProvider,
    tokenAddress: string,
    amountWei: bigint
) => {
    const signer = await provider.getSigner();
    const token = new Contract(tokenAddress, ERC20_ABI, signer);
    const tx = await token.approve(ROUTER_ADDRESS, amountWei);
    return await tx.wait();
};

export const buyTokenDex = async (
    provider: BrowserProvider,
    tokenAddress: string,
    ethAmountWei: bigint,
    minTokensOut: bigint,
    to: string
) => {
    const signer = await provider.getSigner();
    const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    const path = [WETH_ADDRESS, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 mins

    const tx = await router.swapExactETHForTokens(
        minTokensOut,
        path,
        to,
        deadline,
        { value: ethAmountWei }
    );
    return await tx.wait();
};

export const sellTokenDex = async (
    provider: BrowserProvider,
    tokenAddress: string,
    tokenAmountWei: bigint,
    minEthOut: bigint,
    to: string
) => {
    const signer = await provider.getSigner();
    const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    const path = [tokenAddress, WETH_ADDRESS];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await router.swapExactTokensForETH(
        tokenAmountWei,
        minEthOut,
        path,
        to,
        deadline
    );
    return await tx.wait();
};

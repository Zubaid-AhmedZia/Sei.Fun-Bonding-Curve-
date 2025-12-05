import { ethers, BrowserProvider, Contract } from "ethers";

// DragonSwap Router on Sei V2 EVM
const ROUTER_ADDRESS = "0x527b42CA5e11370259EcaE68561C14dA415477C8";
// WSEI on Sei V2 EVM
const WSEI_ADDRESS = "0xF8EB55EC97B59d91fe9E91A1d61147e0d2A7b6F7";

const ROUTER_ABI = [
    "function swapExactSEIForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForSEI(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
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
    seiAmountWei: bigint
): Promise<bigint> => {
    if (seiAmountWei === 0n) return 0n;
    try {
        const router = getRouterContract(provider);
        const path = [WSEI_ADDRESS, tokenAddress];
        const amounts = await router.getAmountsOut(seiAmountWei, path);
        return amounts[1]; // Token amount out
    } catch (e) {
        // Swallow router reverts (e.g. missing pool / low liquidity) and return 0 for UI
        return 0n;
    }
};

// Quote: how much SEI is needed to buy a given amount of tokens (exact out),
// using DragonSwap `getAmountsIn`. Returns 0n when the pool is missing or reverts.
export const getDexQuoteBuyExactOut = async (
    provider: BrowserProvider | ethers.JsonRpcProvider,
    tokenAddress: string,
    tokenAmountWei: bigint,
): Promise<bigint> => {
    if (tokenAmountWei === 0n) return 0n;
    try {
        const router = getRouterContract(provider);
        const path = [WSEI_ADDRESS, tokenAddress];
        const amounts = await router.getAmountsIn(tokenAmountWei, path);
        return amounts[0]; // SEI amount in
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
        const path = [tokenAddress, WSEI_ADDRESS];
        const amounts = await router.getAmountsOut(tokenAmountWei, path);
        return amounts[1]; // SEI amount out
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
    seiAmountWei: bigint,
    minTokensOut: bigint,
    to: string
) => {
    const signer = await provider.getSigner();
    const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    const path = [WSEI_ADDRESS, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 mins

    const tx = await router.swapExactSEIForTokens(
        minTokensOut,
        path,
        to,
        deadline,
        { value: seiAmountWei }
    );
    return await tx.wait();
};

export const sellTokenDex = async (
    provider: BrowserProvider,
    tokenAddress: string,
    tokenAmountWei: bigint,
    minSeiOut: bigint,
    to: string
) => {
    const signer = await provider.getSigner();
    const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    const path = [tokenAddress, WSEI_ADDRESS];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await router.swapExactTokensForSEI(
        tokenAmountWei,
        minSeiOut,
        path,
        to,
        deadline
    );
    return await tx.wait();
};


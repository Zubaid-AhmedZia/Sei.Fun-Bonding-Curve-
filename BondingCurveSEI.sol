// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenRevised.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

/// @title Meme Token Factory with Exponential Bonding Curve + Uniswap Launch
/// @notice Production-style version with 1% trading fee, listing fee, and safety hardening.
/// @dev IMPORTANT: On Sei EVM, the native asset is SEI (still 18 decimals).
///      For production, REMOVE withdrawFees() and only use withdrawProtocolFees().
contract TokenFactory {
    // --- Events ---
    event MemeTokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        uint256 timestamp
    );

    event TokenBought(
        address indexed tokenAddress,
        address indexed buyer,
        uint256 tokenQty,
        uint256 totalPaid, // includes fee
        uint256 timestamp
    );

    event TokenSold(
        address indexed tokenAddress,
        address indexed seller,
        uint256 tokenQty,
        uint256 netRefund, // after fee
        uint256 timestamp
    );

    event TokenLaunched(
        address indexed tokenAddress,
        uint256 ethForLP,          // on Sei this is SEI for LP
        uint256 listingFeeTaken,
        uint256 timestamp
    );

    event ListingFeeUpdated(uint256 newListingFee);

    // --- Structs ---
    struct MemeToken {
        string name;
        string symbol;
        string description;
        string tokenImageUrl;
        uint256 fundingRaised; // SEI reserved for LP (net of trading fees)
        address tokenAddress;
        address creatorAddress;
        bool isLaunched;
    }

    // --- State ---
    address public immutable owner;
    address public immutable uniswapFactory;
    address public immutable uniswapRouter;

    address[] public memeTokenAddresses;
    mapping(address => MemeToken) public addressToMemeToken;
    mapping(address => uint256) public curveSupply; // raw units sold via curve (1e18-based)

    // --- Fees ---
    uint256 public constant MEMETOKEN_CREATION_FEE = 0.000001 ether; // in SEI
    uint256 public constant FEE_BPS = 100; // 1% in basis points
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Listing fee charged at launch, taken from fundingRaised and added to protocolFeeBalance.
    uint256 public listingFee;

    /// @notice All protocol fees accumulated (creation + trading + listing) withdrawable by owner.
    uint256 public protocolFeeBalance;

    // --- Tokenomics Constants ---
    uint256 public constant DECIMALS = 10 ** 18;
    uint256 public constant MAX_SUPPLY = 1_000_000 * DECIMALS;
    uint256 public constant INIT_SUPPLY = (MAX_SUPPLY * 20) / 100; // 20% for LP, minted at token creation (200k)

    // --- Bonding curve parameters (calibrated for Sei) ---
    // Design:
    // - Total supply: 1,000,000
    // - 80% (800,000) sold on curve
    // - 20% (200,000) for LP
    // - Curve raises 115,000 SEI by the time 800k are sold
    // - LP at launch: 200,000 tokens + 115,000 SEI
    // - DEX price at launch: 0.575 SEI/token
    // - MC at launch: 575,000 SEI (~69k USD when SEI ≈ $0.12)
    uint256 public constant INITIAL_PRICE = 11_400_755_737_022_590; // ~0.0114007557 SEI per token at s = 0
    uint256 public constant K             = 4_900_862_993_591;      // curvature, Q18

    /// @notice SEI goal at which token graduates to Uniswap (amount raised by curve).
    ///         115,000 SEI * 1e18 (wei) = 115_000 ether.
    uint256 public constant MEMECOIN_FUNDING_GOAL = 115_000 ether;

    // --- Reentrancy Guard ---
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    // Uniswap Sepolia
    // address public constant UNISWAP_FACTORY = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
    // address public constant UNISWAP_ROUTER  = 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3;
    // --- Constructor ---
    constructor(
        address _uniswapFactory,
        address _uniswapRouter,
        uint256 _listingFee
    ) {
        require(_uniswapFactory != address(0), "zero factory");
        require(_uniswapRouter != address(0), "zero router");
        owner = msg.sender;
        uniswapFactory = _uniswapFactory;
        uniswapRouter = _uniswapRouter;
        listingFee = _listingFee;
        _status = _NOT_ENTERED;
    }

    // --- Admin configuration ---
    function setListingFee(uint256 _listingFee) external onlyOwner {
        listingFee = _listingFee;
        emit ListingFeeUpdated(_listingFee);
    }

    // --- Token Creation ---
    function createMemeToken(
        string memory name,
        string memory symbol,
        string memory imageUrl,
        string memory description
    ) external payable nonReentrant returns (address) {
        require(msg.value >= MEMETOKEN_CREATION_FEE, "Creation fee required");

        // Creation fee is part of protocol fees
        protocolFeeBalance += msg.value;

        // Mint 20% LP supply to this factory; remaining 80% will be minted via bonding curve
        Token token = new Token(name, symbol, MAX_SUPPLY, INIT_SUPPLY);
        token.setFactory(address(this));
        address tokenAddr = address(token);

        memeTokenAddresses.push(tokenAddr);
        addressToMemeToken[tokenAddr] = MemeToken({
            name: name,
            symbol: symbol,
            description: description,
            tokenImageUrl: imageUrl,
            fundingRaised: 0,
            tokenAddress: tokenAddr,
            creatorAddress: msg.sender,
            isLaunched: false
        });

        emit MemeTokenCreated(tokenAddr, msg.sender, block.timestamp);
        return tokenAddr;
    }

    function getAllMemeTokens() external view returns (MemeToken[] memory) {
        uint256 len = memeTokenAddresses.length;
        MemeToken[] memory list = new MemeToken[](len);
        for (uint256 i = 0; i < len; i++) {
            list[i] = addressToMemeToken[memeTokenAddresses[i]];
        }
        return list;
    }

    // --- Bonding Curve Math ---
    function calculateCost(
        uint256 currentRaw,
        uint256 amountRaw
    ) public pure returns (uint256) {
        uint256 exponent1 = (K * (currentRaw + amountRaw)) / DECIMALS;
        uint256 exponent0 = (K * currentRaw) / DECIMALS;
        uint256 exp1 = exp(exponent1);
        uint256 exp0 = exp(exponent0);
        return (INITIAL_PRICE * (exp1 - exp0)) / K;
    }

    /// @notice Given `ethAmount` (total, including 1% fee) returns max whole tokens you can buy on the curve.
    /// @dev Uses binary search and never reverts even if calculateCost would overflow for too-large mid.
    function calculateTokenAmountFromEth(
        address tokenAddr,
        uint256 ethAmount
    ) external view returns (uint256) {
        MemeToken storage mt = addressToMemeToken[tokenAddr];
        require(
            mt.tokenAddress == tokenAddr && tokenAddr != address(0),
            "Unknown token"
        );
        require(!mt.isLaunched, "Already launched");

        uint256 currentRaw = curveSupply[tokenAddr];
        uint256 availRaw = MAX_SUPPLY - INIT_SUPPLY - currentRaw;
        uint256 maxTokens = availRaw / DECIMALS;

        if (maxTokens == 0 || ethAmount == 0) {
            return 0;
        }

        // Only (1 - fee%) of ethAmount actually goes to the curve
        uint256 effectiveEth = (ethAmount * (BPS_DENOMINATOR - FEE_BPS)) /
            BPS_DENOMINATOR;

        uint256 low = 0;
        uint256 high = maxTokens;

        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            uint256 amountRaw = mid * DECIMALS;

            (bool ok, bytes memory data) = address(this).staticcall(
                abi.encodeWithSelector(
                    this.calculateCost.selector,
                    currentRaw,
                    amountRaw
                )
            );

            if (ok) {
                uint256 cost = abi.decode(data, (uint256));
                if (cost <= effectiveEth) {
                    low = mid;
                    continue;
                }
            }
            high = mid - 1;
        }

        return low;
    }

    function calculateRefund(
        uint256 currentRaw,
        uint256 amountRaw
    ) public pure returns (uint256) {
        uint256 exponent1 = (K * currentRaw) / DECIMALS;
        uint256 exponent0 = (K * (currentRaw - amountRaw)) / DECIMALS;
        uint256 exp1 = exp(exponent1);
        uint256 exp0 = exp(exponent0);
        return (INITIAL_PRICE * (exp1 - exp0)) / K;
    }

    /// @dev Fixed-point exp with Q18 scaling: x is exponent * 1e18, result is e^(x/1e18) * 1e18.
    ///      MUST choose K and supply bounds so this does not overflow in practice.
    function exp(uint256 x) internal pure returns (uint256) {
        uint256 sum = DECIMALS; // 1.0
        uint256 term = DECIMALS;
        for (uint256 i = 1; i <= 20; i++) {
            term = (term * x) / (uint256(i) * DECIMALS);
            sum += term;
            if (term < 1) break;
        }
        return sum;
    }

    // --- Pre-launch Buy & Sell ---

    /// @notice Buy up to `tokenQty` whole tokens from the bonding curve for `tokenAddr`.
    /// @dev
    /// - If `tokenQty` exceeds remaining curve supply, it will be partially filled.
    /// - Only the cost for actually minted tokens is kept; any extra ETH is refunded.
    /// - May trigger launch if SEI goal is hit or curve supply is fully sold.
    function buyMemeToken(
        address tokenAddr,
        uint256 tokenQty
    ) external payable nonReentrant returns (uint256) {
        MemeToken storage mt = addressToMemeToken[tokenAddr];
        require(
            mt.tokenAddress == tokenAddr && tokenAddr != address(0),
            "Unknown token"
        );
        require(!mt.isLaunched, "Launched: use Uniswap");

        Token token = Token(tokenAddr);

        uint256 currentRaw = curveSupply[tokenAddr];
        uint256 maxCurveRaw = MAX_SUPPLY - INIT_SUPPLY;
        uint256 availableRaw = maxCurveRaw - currentRaw;

        // No tokens left on the curve at all
        require(availableRaw > 0, "Curve complete");

        // Requested amount in raw units (18 decimals)
        uint256 buyRaw = tokenQty * DECIMALS;

        // Clamp to available curve supply
        if (buyRaw > availableRaw) {
            buyRaw = availableRaw;
        }

        // Should never be zero because availableRaw > 0 above
        require(buyRaw > 0, "Nothing to buy");

        // Cost for the actual tokens being bought
        uint256 curveCost = calculateCost(currentRaw, buyRaw);
        uint256 fee = (curveCost * FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalRequired = curveCost + fee;

        // User must at least send enough SEI for the actual number of tokens being bought
        require(msg.value >= totalRequired, "Insufficient SEI sent");

        // Accounting
        protocolFeeBalance += fee;
        mt.fundingRaised += curveCost;
        curveSupply[tokenAddr] = currentRaw + buyRaw;

        // Mint tokens (buyRaw is in 1e18 units)
        uint256 actualTokenQty = buyRaw / DECIMALS; // whole tokens
        token.mint(buyRaw, msg.sender);

        emit TokenBought(
            tokenAddr,
            msg.sender,
            actualTokenQty,
            totalRequired,
            block.timestamp
        );

        // Refund any excess SEI (e.g. user asked for more than available)
        if (msg.value > totalRequired) {
            uint256 excess = msg.value - totalRequired;
            (bool success, ) = msg.sender.call{value: excess}("");
            require(success, "Refund failed");
        }

        // Graduation conditions:
        //  - SEI goal hit, OR
        //  - full curve supply sold (800k tokens)
        if (
            !mt.isLaunched &&
            (mt.fundingRaised >= MEMECOIN_FUNDING_GOAL ||
                curveSupply[tokenAddr] >= maxCurveRaw)
        ) {
            uint256 lpEth = mt.fundingRaised;
            uint256 takenListingFee = 0;

            if (listingFee > 0 && lpEth > listingFee) {
                lpEth -= listingFee;
                protocolFeeBalance += listingFee;
                takenListingFee = listingFee;
            }

            mt.isLaunched = true;
            mt.fundingRaised = 0;

            _launchOnUniswap(tokenAddr, lpEth);

            emit TokenLaunched(
                tokenAddr,
                lpEth,
                takenListingFee,
                block.timestamp
            );
        }

        // Return the actual SEI spent (excluding refund) for convenience
        return totalRequired;
    }

    /// @notice Sell `tokenQty` whole tokens back to the bonding curve.
    /// @dev Returns NET SEI refunded (after 1% fee). Reverts if already launched.
    function sellMemeToken(
        address tokenAddr,
        uint256 tokenQty
    ) external nonReentrant returns (uint256) {
        MemeToken storage mt = addressToMemeToken[tokenAddr];
        require(
            mt.tokenAddress == tokenAddr && tokenAddr != address(0),
            "Unknown token"
        );
        require(!mt.isLaunched, "Launched: use Uniswap");

        Token token = Token(tokenAddr);
        uint256 qtyRaw = tokenQty * DECIMALS;

        uint256 currentRaw = curveSupply[tokenAddr];

        require(token.balanceOf(msg.sender) >= qtyRaw, "Insufficient balance");
        require(currentRaw >= qtyRaw, "Curve supply too low");

        uint256 refund = calculateRefund(currentRaw, qtyRaw);
        require(mt.fundingRaised >= refund, "Insufficient curve SEI");

        uint256 fee = (refund * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netRefund = refund - fee;

        protocolFeeBalance += fee;
        mt.fundingRaised -= refund;
        curveSupply[tokenAddr] = currentRaw - qtyRaw;

        token.burn(qtyRaw, msg.sender);

        (bool success, ) = msg.sender.call{value: netRefund}("");
        require(success, "SEI transfer failed");

        emit TokenSold(
            tokenAddr,
            msg.sender,
            tokenQty,
            netRefund,
            block.timestamp
        );
        return netRefund;
    }

    // --- Uniswap Launch Helpers ---
    function _launchOnUniswap(address tokenAddr, uint256 ethAmount) internal {
        require(ethAmount > 0, "No SEI for LP");

        IUniswapV2Factory factory = IUniswapV2Factory(uniswapFactory);
        IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);

        address weth = router.WETH(); // on Sei this should be WSEI
        address pair = factory.getPair(tokenAddr, weth);
        if (pair == address(0)) {
            pair = factory.createPair(tokenAddr, weth);
        }

        // Ensure we actually have INIT_SUPPLY tokens available for LP
        require(
            Token(tokenAddr).balanceOf(address(this)) >= INIT_SUPPLY,
            "Insufficient LP tokens"
        );

        Token(tokenAddr).approve(address(router), INIT_SUPPLY);

        (, , uint256 liquidity) = router.addLiquidityETH{value: ethAmount}(
            tokenAddr,
            INIT_SUPPLY,
            INIT_SUPPLY, // min tokens
            ethAmount,   // min SEI
            address(this),
            block.timestamp
        );

        require(liquidity > 0, "No liquidity minted");

        // Burn LP to lock liquidity
        IUniswapV2Pair(pair).transfer(address(0), liquidity);
    }

    // --- Admin helpers ---

    /// @notice Withdraw only accumulated protocol fees (creation, trading, listing).
    function withdrawProtocolFees(
        address payable to
    ) external onlyOwner nonReentrant {
        require(to != address(0), "zero");
        uint256 amount = protocolFeeBalance;
        require(amount > 0, "no fees");
        protocolFeeBalance = 0;

        (bool success, ) = to.call{value: amount}("");
        require(success, "SEI transfer failed");
    }

    /// @notice TESTING ONLY: withdraw ALL SEI from the contract (including LP SEI).
    /// @dev DO NOT SHIP THIS IN PRODUCTION.
    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "zero");
        uint256 bal = address(this).balance;
        require(bal > 0, "no balance");

        (bool success, ) = to.call{value: bal}("");
        require(success, "SEI transfer failed");
    }
}

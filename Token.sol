// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Meme Token used by TokenFactory bonding curve + Uniswap launch
/// @notice Minimal ERC20 with controlled mint/burn by factory only and a hard maxSupply
contract Token {
    // --- ERC20 storage ---
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public immutable maxSupply;
    uint256 public totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // --- Access control ---
    address public factory;
    bool private factoryLocked; // once setFactory is called successfully, it locks

    // --- Events (ERC20 standard + extras) ---
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    event FactorySet(address indexed factory);
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);

    // --- Modifiers ---
    modifier onlyFactory() {
        require(msg.sender == factory, "Not factory");
        _;
    }

    // --- Constructor ---
    /// @param _name ERC20 name
    /// @param _symbol ERC20 symbol
    /// @param _maxSupply Maximum supply in raw units (18 decimals)
    /// @param _initialLpSupply Amount to mint immediately to the factory (LP tokens)
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply,
        uint256 _initialLpSupply
    ) {
        require(_maxSupply > 0, "maxSupply zero");
        require(_initialLpSupply <= _maxSupply, "init > max");

        name = _name;
        symbol = _symbol;
        maxSupply = _maxSupply;

        // Mint initial LP supply to deployer (TokenFactory)
        _mint(msg.sender, _initialLpSupply);
    }

    // ======================================================
    //                  ERC20 PUBLIC VIEW
    // ======================================================

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }

    // ======================================================
    //                  ERC20 MUTATING
    // ======================================================

    function transfer(address to, uint256 amount) public returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");

        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }

        _transfer(from, to, amount);
        return true;
    }

    // ======================================================
    //          FACTORY MANAGEMENT + BONDING CURVE API
    // ======================================================

    /// @notice One-time link between this token and its TokenFactory.
    function setFactory(address _factory) external {
        require(!factoryLocked, "Factory already set");
        require(_factory != address(0), "Zero factory");

        factory = _factory;
        factoryLocked = true;

        emit FactorySet(_factory);
    }

    /// @notice Mint new tokens to `to`.
    /// @dev Only callable by the bonded curve / TokenFactory.
    function mint(uint256 amount, address to) external onlyFactory {
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /// @notice Burn tokens from `from`.
    /// @dev Only callable by the TokenFactory on user sell.
    function burn(uint256 amount, address from) external onlyFactory {
        _burn(from, amount);
        emit Burned(from, amount);
    }

    // ======================================================
    //                  INTERNAL CORE LOGIC
    // ======================================================

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from zero");
        require(to != address(0), "ERC20: transfer to zero");

        uint256 fromBal = _balances[from];
        require(fromBal >= amount, "ERC20: transfer > balance");

        unchecked {
            _balances[from] = fromBal - amount;
        }

        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "ERC20: mint to zero");
        require(totalSupply + amount <= maxSupply, "max supply exceeded");

        totalSupply += amount;
        _balances[to] += amount;

        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(from != address(0), "ERC20: burn from zero");

        uint256 fromBal = _balances[from];
        require(fromBal >= amount, "ERC20: burn > balance");

        unchecked {
            _balances[from] = fromBal - amount;
        }

        totalSupply -= amount;

        emit Transfer(from, address(0), amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from zero");
        require(spender != address(0), "ERC20: approve to zero");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}


//https://chatgpt.com/c/691efff4-198c-8322-9edd-e38c0628d8c3
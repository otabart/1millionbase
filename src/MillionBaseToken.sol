// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MillionBaseToken (MBT)
/// @notice Simple ERC-20 with a hard cap of 1 000 000 tokens and a permission-less `claim` minting function.
///         Each call to `claim` mints exactly one token to the caller until the cap is reached.
contract MillionBaseToken is ERC20, Ownable {
    /// @dev Hard-cap expressed in whole tokens (decimals = 0).
    uint256 public constant MAX_SUPPLY = 1_000_000;

    /// @dev Mapping of cell index to owner address (zero address if unclaimed).
    mapping(uint256 => address) public claimedBy;

    /// @notice Emitted when an address successfully claims a specific cell.
    event Claimed(address indexed claimer, uint256 indexed cellIndex);

    constructor() ERC20("MillionBaseToken", "MBT") Ownable(msg.sender) {
        // start with zero supply; everything is minted via claim/ownerMint.
    }

    /// @notice Claim the token associated with the given grid cell.
    /// @param cellIndex 0-based index in the 1 000 000 grid.
    function claim(uint256 cellIndex) external returns (bool success) {
        require(cellIndex < MAX_SUPPLY, "index out of range");
        require(claimedBy[cellIndex] == address(0), "already claimed");
        require(totalSupply() < MAX_SUPPLY, "Max supply reached");

        claimedBy[cellIndex] = msg.sender;
        _mint(msg.sender, 1);
        emit Claimed(msg.sender, cellIndex);
        return true;
    }

    /// @notice Returns true if the specified cell has already been claimed.
    function isClaimed(uint256 cellIndex) external view returns (bool) {
        return claimedBy[cellIndex] != address(0);
    }

    /// @notice Owner-only claim on behalf of an address for a specific cell (e.g., giveaways).
    function ownerClaim(address to, uint256 cellIndex) external onlyOwner {
        require(cellIndex < MAX_SUPPLY, "index out of range");
        require(claimedBy[cellIndex] == address(0), "already claimed");
        claimedBy[cellIndex] = to;
        _mint(to, 1);
    }

    /// @dev Override decimals to return 0 so that one token equals one click.
    function decimals() public view virtual override returns (uint8) {
        return 0;
    }
} 
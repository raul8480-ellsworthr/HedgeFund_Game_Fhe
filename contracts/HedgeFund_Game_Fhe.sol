pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HedgeFundGameFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidAddress();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedStateChanged(bool paused);
    event CooldownSecondsChanged(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event FundStrategySubmitted(address indexed provider, uint256 batchId, uint256 encryptedStrategyId);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, uint256[] cleartexts);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionRequestCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        providers[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        cooldownSeconds = 60; 
        currentBatchId = 1;
        emit BatchOpened(currentBatchId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidAddress();
        if (!providers[provider]) {
            providers[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (providers[provider]) {
            providers[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(paused);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSecondsChanged(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function openNewBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeCurrentBatch() external onlyOwner whenNotPaused {
        if (batchClosed[currentBatchId]) revert BatchClosed();
        batchClosed[currentBatchId] = true;
        emit BatchClosed(currentBatchId);
    }

    function _initIfNeeded(euint32 storage value, uint32 initialValue) internal {
        if (!value.isInitialized()) {
            value.asEuint32(initialValue);
        }
    }

    function _requireInitialized(euint32 storage value) internal view {
        if (!value.isInitialized()) {
            revert NotInitialized();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function submitFundStrategy(
        euint32 storage strategyId,
        euint32 storage riskFactor,
        euint32 storage capitalAllocation
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (batchClosed[currentBatchId]) revert BatchClosed();

        _initIfNeeded(strategyId, 0);
        _initIfNeeded(riskFactor, 0);
        _initIfNeeded(capitalAllocation, 0);

        _requireInitialized(strategyId);
        _requireInitialized(riskFactor);
        _requireInitialized(capitalAllocation);

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit FundStrategySubmitted(msg.sender, currentBatchId, FHE.toBytes32(strategyId));
    }

    function requestPerformanceDecryption(
        euint32 storage fundPerformance,
        euint32 storage marketImpact
    ) external onlyProvider whenNotPaused checkDecryptionRequestCooldown {
        _requireInitialized(fundPerformance);
        _requireInitialized(marketImpact);

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(fundPerformance);
        cts[1] = FHE.toBytes32(marketImpact);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) {
            revert ReplayDetected();
        }

        euint32 storage fundPerformance = euint32.wrap(0); 
        euint32 storage marketImpact = euint32.wrap(0);  

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(fundPerformance);
        cts[1] = FHE.toBytes32(marketImpact);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint256[] memory results = abi.decode(cleartexts, (uint256[]));
        require(results.length == 2, "Invalid cleartexts length");

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, results);
    }
}
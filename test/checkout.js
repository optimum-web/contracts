const Checkout = artifacts.require("Checkout.sol");
const DINRegistry = artifacts.require("DINRegistry.sol");
const DINRegistrar = artifacts.require("DINRegistrar.sol");
const MarketToken = artifacts.require("MarketToken.sol");
const PublicURLResolver = artifacts.require("PublicURLResolver.sol");
const Promise = require("bluebird");
const chai = require("chai"),
    expect = chai.expect,
    should = chai.should();
const utils = require("web3-utils");

contract("Checkout", accounts => {
    const IS_DEBUG = false; // Set to true for additional logging

    // Contracts
    let checkout;
    let registry;
    let registrar;
    let resolver;

    // Accounts
    const BUYER = accounts[0];
    const MERCHANT = accounts[1];
    const AFFILIATE = accounts[2];

    // Errors
    const ERROR_OFFER_EXPIRED = "Offer expired";
    const ERROR_INVALID_PRICE = "Invalid price";
    const ERROR_INVALID_RESOLVER = "Invalid resolver";
    const ERROR_INVALID_MERCHANT = "Invalid merchant";
    const ERROR_INVALID_SIGNATURE = "Invalid signature";
    const ERROR_INVALID_AFFILIATE = "Invalid affiliate";

    // Tokens
    let MARKET_TOKEN_ADDRESS;
    const NO_LOYALTY_TOKEN = "0x0000000000000000000000000000000000000000";

    // Addresses
    const NO_AFFILIATE = "0x0000000000000000000000000000000000000000";

    // DINs
    const DIN = 1000000011;
    const DIN_NO_MERCHANT = 1000000012;
    const DIN_NO_RESOLVER = 1000000013;

    // Price valid until
    const FUTURE_DATE = 1577836800; // 1/1/2020
    const EXPIRED_DATE = 1483228800; // 1/1/2017

    // Price
    const PRICE = 5 * Math.pow(10, 17); // 0.5 ETH
    const PRICE_TOO_HIGH = 500 * Math.pow(10, 18); // 5,000 ETH

    // Affiliate Reward
    const AFFILIATE_REWARD = 1 * Math.pow(10, 18); // 1 MARK
    const NO_AFFILIATE_REWARD = 0;

    // Loyalty Reward
    const NO_LOYALTY_REWARD = 0;

    // Quantity
    const QUANTITY_ONE = 1;
    const QUANTITY_MANY = 17;

    // Constants
    // NOTE: Setting a positive gas price will cause a couple of the tests to be off by a very small margin of error.
    const GAS_PRICE = web3.toWei(0, "gwei");
    const NONCE_HASH = utils.sha3("TEST");

    // Valid order parameters
    const ORDER_VALUES = [
        DIN,
        QUANTITY_ONE,
        PRICE,
        FUTURE_DATE,
        NO_AFFILIATE_REWARD,
        NO_LOYALTY_REWARD
    ];
    const ORDER_ADDRESSES = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

    const getDINFromLog = async () => {
        const registrationEvent = registry.NewRegistration({ owner: MERCHANT });
        const eventAsync = Promise.promisifyAll(registrationEvent);
        const logs = await eventAsync.getAsync();

        const DIN = parseInt(logs[0]["args"]["DIN"]);
        return DIN;
    };

    const getHash = values => {
        if (IS_DEBUG === true) {
            console.log("VALUES: " + values);
        }
        // http://web3js.readthedocs.io/en/1.0/web3-utils.html#soliditysha3
        const hash = utils.soliditySha3(...values);
        return hash;
    };

    const getSignature = (values, account = MERCHANT) => {
        const hash = getHash(values);
        if (IS_DEBUG === true) {
            console.log("HASH: " + hash);
        }

        console.log(hash);
        const signedMessage = web3.eth.sign(account, hash);

        // https://ethereum.stackexchange.com/questions/1777/workflow-on-signing-a-string-with-private-key-followed-by-signature-verificatio/1794#1794
        const v = "0x" + signedMessage.slice(130, 132);
        const r = signedMessage.slice(0, 66);
        const s = "0x" + signedMessage.slice(66, 130);

        const signature = {
            v: web3.toDecimal(v) + 27,
            r: r,
            s: s
        };

        console.log(signature);

        if (IS_DEBUG === true) {
            console.log("SIGNATURE: " + signature);
        }

        return signature;
    };

    const getBuyResult = async (
        values,
        addresses,
        owner = MERCHANT,
        buyer = BUYER
    ) => {
        const hashValues = [
            values[0], // DIN
            values[2], // price
            values[3], // priceValidUntil
            values[4], // affiliateReward
            values[5], // loyaltyReward
            addresses[1] // loyaltyToken
        ];
        const signature = getSignature(hashValues, owner);

        const result = await checkout.buy(
            values,
            addresses,
            NONCE_HASH,
            signature.v,
            signature.r,
            signature.s,
            {
                from: buyer,
                value: values[2],
                gasPrice: GAS_PRICE
            }
        );

        return result;
    };

    before(async () => {
        checkout = await Checkout.deployed();
        registry = await DINRegistry.deployed();
        registrar = await DINRegistrar.deployed();
        marketToken = await MarketToken.deployed();
        resolver = await PublicURLResolver.deployed();

        MARKET_TOKEN_ADDRESS = marketToken.address;

        // Register 3 DINs.
        await registrar.registerDINs(3, { from: MERCHANT });

        // Set the resolver for the first two DINs.
        await registry.setResolver(DIN, resolver.address, { from: MERCHANT });
        await registry.setResolver(DIN_NO_MERCHANT, resolver.address, {
            from: MERCHANT
        });

        // Set the merchant for the first DIN. MERCHANT is the DIN owner and merchant.
        await resolver.setMerchant(DIN, MERCHANT, { from: MERCHANT });

        // Give MERCHANT some Market Tokens so he can promote his product by offering affiliate rewards.
        await marketToken.transfer(MERCHANT, AFFILIATE_REWARD * 5, { from: BUYER });
    });

    it("should have the correct registry", async () => {
        const checkoutRegistry = await checkout.registry();
        expect(checkoutRegistry).to.equal(registry.address);
    });

    it("should have the correct token", async () => {
        const checkoutToken = await checkout.marketToken();
        expect(checkoutToken).to.equal(marketToken.address);
    });

    it("should log an error if the expiration time has passed", async () => {
        const values = [
            DIN,
            QUANTITY_ONE,
            PRICE,
            EXPIRED_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        const result = await getBuyResult(values, addresses);
        expect(result.logs[0].args.error).to.equal(ERROR_OFFER_EXPIRED);
    });

    it("should log an error if the resolver is not set", async () => {
        const values = [
            DIN_NO_RESOLVER,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        const result = await getBuyResult(values, addresses);
        expect(result.logs[0].args.error).to.equal(ERROR_INVALID_RESOLVER);
    });

    it("should log an error if the merchant is not set", async () => {
        const values = [
            DIN_NO_MERCHANT,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        const result = await getBuyResult(values, addresses);
        expect(result.logs[0].args.error).to.equal(ERROR_INVALID_MERCHANT);
    });

    it("should log an error if the signature is invalid", async () => {
        const values = [
            DIN,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        const result = await checkout.buy(
            values,
            addresses,
            NONCE_HASH,
            27,
            "0x0000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000"
        );
        expect(result.logs[0].args.error).to.equal(ERROR_INVALID_SIGNATURE);
    });

    it("should log an error if the price does not match the signed price", async () => {
        const values = [
            DIN,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        const signature = getSignature(values, MERCHANT);

        // Set the price low to try to get the item for less
        const fakeValues = [
            DIN,
            QUANTITY_ONE,
            1,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];

        const result = await checkout.buy(
            fakeValues,
            addresses,
            NONCE_HASH,
            signature.v,
            signature.r,
            signature.s
        );
        expect(result.logs[0].args.error).to.equal(ERROR_INVALID_SIGNATURE);
    });

    it("should validate a signature", async () => {
        const hashValues = [
            DIN,
            PRICE,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD,
            NO_LOYALTY_TOKEN
        ];
        const signature = getSignature(hashValues);
        const hash = getHash(hashValues);

        const result = await checkout.isValidSignature(
            MERCHANT,
            hash,
            signature.v,
            signature.r,
            signature.s
        );
        expect(result).to.equal(true);

        const fakeValues = [
            DIN,
            QUANTITY_ONE,
            1,
            FUTURE_DATE,
            NO_AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const fakeHash = getHash(fakeValues);
        const fakeResult = await checkout.isValidSignature(
            MERCHANT,
            fakeHash,
            signature.v,
            signature.r,
            signature.s
        );
        expect(fakeResult).to.equal(false);
    });

    it("should process a valid purchase", async () => {
        const values = ORDER_VALUES;
        const addresses = ORDER_ADDRESSES;

        const beginIndex = await checkout.orderIndex();
        const beginBalanceBuyer = await web3.eth.getBalance(BUYER);
        const beginBalanceMerchant = await web3.eth.getBalance(MERCHANT);

        const result = await getBuyResult(values, addresses);
        const gasUsed = result.receipt.gasUsed;

        const endIndex = await checkout.orderIndex();
        expect(endIndex.toNumber()).to.equal(beginIndex.toNumber() + 1);

        const endBalanceBuyer = await web3.eth.getBalance(BUYER);
        const endBalanceMerchant = await web3.eth.getBalance(MERCHANT);

        const expectedBuyer =
            beginBalanceBuyer.toNumber() - PRICE - gasUsed * GAS_PRICE;
        const expectedMerchant = beginBalanceMerchant.toNumber() + PRICE;

        expect(endBalanceBuyer.toNumber()).to.equal(expectedBuyer);
        expect(endBalanceMerchant.toNumber()).to.equal(expectedMerchant);
    });

    it("should not allow a buyer to set herself as the affiliate", async () => {
        const values = [
            DIN,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [BUYER, NO_LOYALTY_TOKEN];

        const result = await getBuyResult(values, addresses);
        expect(result.logs[0].args.error).to.equal(ERROR_INVALID_AFFILIATE);
    });

    it("should reward a valid affiliate", async () => {
        // MERCHANT will offer 1 MARK to any affiliate that sells his product for 5 ETH.
        // AFFILIATE gets BUYER to purchase the product with her affiliate link.
        const values = [
            DIN,
            QUANTITY_ONE,
            PRICE,
            FUTURE_DATE,
            AFFILIATE_REWARD,
            NO_LOYALTY_REWARD
        ];
        const addresses = [AFFILIATE, NO_LOYALTY_TOKEN];

        // Ether beginning balances
        const beginBalanceBuyerETH = await web3.eth.getBalance(BUYER);
        const beginBalanceMerchantETH = await web3.eth.getBalance(MERCHANT);

        // Market Token beginning balances
        const beginBalanceMerchantMARK = await marketToken.balanceOf(MERCHANT);
        const beginBalanceAffiliateMARK = await marketToken.balanceOf(AFFILIATE);

        const result = await getBuyResult(values, addresses);
        const gasUsed = result.receipt.gasUsed;

        // Ether ending balances
        const endBalanceBuyerETH = await web3.eth.getBalance(BUYER);
        const endBalanceMerchantETH = await web3.eth.getBalance(MERCHANT);

        // Market Token beginning balances
        const endBalanceMerchantMARK = await marketToken.balanceOf(MERCHANT);
        const endBalanceAffiliateMARK = await marketToken.balanceOf(AFFILIATE);

        // Expected values
        const expectedEndBalanceBuyerETH = beginBalanceBuyerETH.toNumber() - PRICE - (gasUsed * GAS_PRICE);
        const expectedEndBalanceMerchantETH = beginBalanceMerchantETH.toNumber() + PRICE;
        const expectedEndBalanceMerchantMARK = beginBalanceMerchantMARK.toNumber() - AFFILIATE_REWARD;
        const expectedEndBalanceAffiliateMARK = beginBalanceAffiliateMARK.toNumber() + AFFILIATE_REWARD;

        expect(endBalanceBuyerETH.toNumber()).to.equal(expectedEndBalanceBuyerETH);
        expect(endBalanceMerchantETH.toNumber()).to.equal(expectedEndBalanceMerchantETH);
        expect(endBalanceMerchantMARK.toNumber()).to.equal(expectedEndBalanceMerchantMARK);
        expect(endBalanceAffiliateMARK.toNumber()).to.equal(expectedEndBalanceAffiliateMARK);
    });

    it("should throw if the buyer does not have enough tokens", async () => {
        const values = [DIN, QUANTITY_ONE, PRICE_TOO_HIGH, FUTURE_DATE, NO_AFFILIATE_REWARD, NO_LOYALTY_REWARD];
        const addresses = [NO_AFFILIATE, NO_LOYALTY_TOKEN];

        try {
            await getBuyResult(values, addresses);
        } catch (error) {
            assert.include(
                error.message,
                "sender doesn\'t have enough funds to send tx",
                "Buying a product without enough tokens should throw an error."
            );
        }
    });

});
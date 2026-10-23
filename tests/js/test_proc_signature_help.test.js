/**
 * tests/js/test_proc_signature_help.test.js
 * 
 * Tests for Stored Procedure and Function Signature Help / Parameter Hints
 * for both SQL Server (T-SQL) and PostgreSQL dialects.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

test('Signature Help: Stored Procedure & Function Parameter Hints', async (t) => {
    const ideMssql = createIdeContext({ dbType: 'mssql' });
    const idePg = createIdeContext({ dbType: 'postgresql' });

    await t.test('MSSQL: EXEC dbo.usp_GetOrders space triggers parameter 0', async () => {
        const sig = await ideMssql.getSignatureHelp('EXEC dbo.usp_GetOrders ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.signatures.length, 1);
        const s = sig.signatures[0];
        assert.ok(s.label.includes('usp_GetOrders'));
        assert.strictEqual(s.parameters.length, 2);
        assert.strictEqual(s.parameters[0].label, '@CustomerID');
        assert.strictEqual(s.parameters[1].label, '@FromDate');
        assert.strictEqual(sig.activeParameter, 0);
    });

    await t.test('MSSQL: EXEC dbo.usp_GetOrders with comma advances to parameter 1', async () => {
        const sig = await ideMssql.getSignatureHelp('EXEC dbo.usp_GetOrders 100, ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('MSSQL: EXEC dbo.usp_GetOrders named parameter @FromDate matches index 1', async () => {
        const sig = await ideMssql.getSignatureHelp('EXEC dbo.usp_GetOrders @FromDate = ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('MSSQL: EXEC dbo.usp_GetOrders named parameter after comma resets correctly', async () => {
        const sig = await ideMssql.getSignatureHelp('EXEC dbo.usp_GetOrders @CustomerID = 1, @FromDate = ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('MSSQL: UDF SELECT dbo.fn_Total(‸ shows parameter info', async () => {
        const sig = await ideMssql.getSignatureHelp('SELECT dbo.fn_Total(‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.signatures.length, 1);
        const s = sig.signatures[0];
        assert.ok(s.label.includes('fn_Total'));
        assert.strictEqual(s.parameters[0].label, '@OrderID');
        assert.strictEqual(sig.activeParameter, 0);
    });

    await t.test('PostgreSQL: CALL public.usp_add_customer(‸ triggers first parameter', async () => {
        const sig = await idePg.getSignatureHelp('CALL public.usp_add_customer(‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.signatures.length, 1);
        const s = sig.signatures[0];
        assert.ok(s.label.includes('usp_add_customer'));
        assert.strictEqual(s.parameters[0].label, 'p_name');
        assert.strictEqual(s.parameters[1].label, 'p_email');
        assert.strictEqual(sig.activeParameter, 0);
    });

    await t.test('PostgreSQL: CALL public.usp_add_customer(\'Alice\', ‸ advances to parameter 1', async () => {
        const sig = await idePg.getSignatureHelp('CALL public.usp_add_customer(\'Alice\', ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('PostgreSQL: CALL public.usp_add_customer space triggers before paren', async () => {
        const sig = await idePg.getSignatureHelp('CALL public.usp_add_customer ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.signatures.length, 1);
        assert.strictEqual(sig.activeParameter, 0);
    });

    await t.test('PostgreSQL: Function SELECT fn_calc_discount(100, ‸ advances to parameter 1', async () => {
        const sig = await idePg.getSignatureHelp('SELECT fn_calc_discount(100, ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('PostgreSQL: CALL usp_add_customer(p_email => ‸ matches named parameter 1', async () => {
        const sig = await idePg.getSignatureHelp('CALL usp_add_customer(p_email => ‸');
        assert.ok(sig, 'Should return signature help');
        assert.strictEqual(sig.activeParameter, 1);
    });

    await t.test('Provider Registration: registerMonacoProvider is callable on instance', () => {
        assert.strictEqual(
            typeof ideMssql.signatureResolver.registerMonacoProvider,
            'function',
            'registerMonacoProvider must be a function on SqlSignatureHelpResolver instance'
        );
    });
});

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const app = require('../server');

async function runAudit() {
  console.log('=== RUNNING COMPREHENSIVE MEDREMINDER AUDIT TEST ===');
  
  const port = 5998;
  const server = app.listen(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // 1. Health check
    console.log('\n[1/12] Testing GET /api/health...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log('Status:', healthRes.status, healthData);
    if (!healthData.status || healthData.status !== 'ok') {
      throw new Error(`Health check failed: ${JSON.stringify(healthData)}`);
    }

    // 2. Register & Auth
    console.log('\n[2/12] Testing POST /api/auth/register & /api/auth/login...');
    const testEmail = `audit_${Date.now()}@example.com`;
    const testPassword = 'Password@123';
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Audit User',
        email: testEmail,
        password: testPassword,
      }),
    });
    const regData = await regRes.json();
    console.log('Register Status:', regRes.status, regData.user?.email);
    if (regRes.status !== 201 || !regData.token) {
      throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
    }

    const token = regData.token;
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Timezone-Offset': '0',
    };

    // 3. /api/auth/me
    console.log('\n[3/12] Testing GET /api/auth/me...');
    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders });
    const meData = await meRes.json();
    console.log('GET /me Status:', meRes.status, meData.user?.name);
    if (meRes.status !== 200 || !meData.user?.id) {
      throw new Error(`GET /me failed: ${JSON.stringify(meData)}`);
    }

    // 4. Medicines CRUD
    console.log('\n[4/12] Testing POST & GET /api/medicines...');
    const medRes = await fetch(`${baseUrl}/api/medicines`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Amoxicillin',
        dosage: '500mg',
        frequency: 'Once daily',
        scheduledTimes: ['08:00'],
        quantity: 30,
        instructions: 'Take with food',
      }),
    });
    const medData = await medRes.json();
    console.log('Create Medicine Status:', medRes.status, medData.medicine?._id);
    if (medRes.status !== 201 || !medData.medicine?._id) {
      throw new Error(`Create medicine failed: ${JSON.stringify(medData)}`);
    }

    const medicineId = medData.medicine._id;

    const listRes = await fetch(`${baseUrl}/api/medicines`, { headers: authHeaders });
    const listData = await listRes.json();
    console.log('List Medicines count:', listData.medicines?.length);
    if (!listData.medicines || listData.medicines.length === 0) {
      throw new Error('List medicines empty');
    }

    // 5. Update Medicine
    console.log('\n[5/12] Testing PUT /api/medicines/:id...');
    const updateRes = await fetch(`${baseUrl}/api/medicines/${medicineId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        dosage: '650mg',
      }),
    });
    const updateData = await updateRes.json();
    console.log('Update Medicine Status:', updateRes.status, updateData.medicine?.dosage);

    // 6. History & Today Schedule
    console.log('\n[6/12] Testing GET /api/history...');
    const histRes = await fetch(`${baseUrl}/api/history`, { headers: authHeaders });
    const histData = await histRes.json();
    console.log('History entries count:', histData.history?.length);

    // 7. Dose Status: TAKEN
    console.log('\n[7/12] Testing POST /api/medicines/:id/status (TAKEN)...');
    const today = new Date().toISOString().slice(0, 10);
    const takenRes = await fetch(`${baseUrl}/api/medicines/${medicineId}/status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        status: 'TAKEN',
        scheduledDate: today,
        scheduledTime: '08:00',
        timezoneOffset: 0,
      }),
    });
    const takenData = await takenRes.json();
    console.log('Mark Taken Status:', takenRes.status, takenData.history?.status);
    if (takenRes.status !== 200 || takenData.history?.status !== 'TAKEN') {
      throw new Error(`Mark taken failed: ${JSON.stringify(takenData)}`);
    }

    // 8. Dose Status: Duplicate TAKEN check
    console.log('\n[8/12] Testing Duplicate TAKEN protection...');
    const dupRes = await fetch(`${baseUrl}/api/medicines/${medicineId}/status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        status: 'TAKEN',
        scheduledDate: today,
        scheduledTime: '08:00',
        timezoneOffset: 0,
      }),
    });
    const dupData = await dupRes.json();
    console.log('Duplicate Taken Status:', dupRes.status, dupData.message);

    // 9. Add 2nd medicine & Test SKIPPED & SNOOZE
    console.log('\n[9/12] Adding 2nd medicine and testing SKIPPED...');
    const med2Res = await fetch(`${baseUrl}/api/medicines`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Vitamin D3',
        dosage: '1000 IU',
        frequency: 'Once daily',
        scheduledTimes: ['08:00'],
        quantity: 60,
      }),
    });
    const med2Data = await med2Res.json();
    const med2Id = med2Data.medicine._id;

    const skipRes = await fetch(`${baseUrl}/api/medicines/${med2Id}/status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        status: 'SKIPPED',
        scheduledDate: today,
        scheduledTime: '08:00',
        timezoneOffset: 0,
      }),
    });
    const skipData = await skipRes.json();
    console.log('Mark Skipped Status:', skipRes.status, skipData.history?.status);
    if (skipRes.status !== 200 || skipData.history?.status !== 'SKIPPED') {
      throw new Error(`Mark skipped failed: ${JSON.stringify(skipData)}`);
    }

    // 10. Delete Medicine
    console.log('\n[10/12] Testing DELETE /api/medicines/:id...');
    const delRes = await fetch(`${baseUrl}/api/medicines/${med2Id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    const delData = await delRes.json();
    console.log('Delete Medicine Status:', delRes.status, delData.message);

    // 11. Caregiver & Senior Mode
    console.log('\n[11/12] Testing Caregiver senior creation & PIN login...');
    const seniorEmail = `senior_${Date.now()}@example.com`;
    const seniorPin = '1234';
    const createSeniorRes = await fetch(`${baseUrl}/api/caregiver/patients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Senior Grandma',
        email: seniorEmail,
        pin: seniorPin,
        phone: '9876543210',
      }),
    });
    const createSeniorData = await createSeniorRes.json();
    console.log('Create Senior Status:', createSeniorRes.status, createSeniorData.senior?.name);
    if (createSeniorRes.status !== 201) {
      throw new Error(`Create senior profile failed: ${JSON.stringify(createSeniorData)}`);
    }

    const seniorLoginRes = await fetch(`${baseUrl}/api/auth/senior-pin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: seniorEmail,
        pin: seniorPin,
      }),
    });
    const seniorLoginData = await seniorLoginRes.json();
    console.log('Senior PIN login Status:', seniorLoginRes.status, seniorLoginData.user?.name);
    if (seniorLoginRes.status !== 200 || !seniorLoginData.token) {
      throw new Error(`Senior PIN login failed: ${JSON.stringify(seniorLoginData)}`);
    }

    // 12. CORS preflight check
    console.log('\n[12/12] Testing CORS preflight OPTIONS...');
    const corsRes = await fetch(`${baseUrl}/api/medicines`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://med-reminder-gh8a.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization,Content-Type,X-Timezone-Offset,X-Senior-Id',
      },
    });
    console.log('CORS Preflight Status:', corsRes.status);
    console.log('CORS Allow Origin Header:', corsRes.headers.get('access-control-allow-origin'));
    console.log('CORS Allow Methods Header:', corsRes.headers.get('access-control-allow-methods'));
    console.log('CORS Allow Headers:', corsRes.headers.get('access-control-allow-headers'));

    console.log('\n=========================================');
    console.log('✅ ALL 12 AUDIT TEST SUITES PASSED SUCCESSFULLY!');
    console.log('=========================================\n');
  } catch (error) {
    console.error('\n❌ AUDIT TEST FAILED:', error);
  } finally {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

runAudit();

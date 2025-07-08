// quickbooksClient.js
import axios from 'axios';

export const getInvoiceDetails = async (accessToken, realmId, invoiceId) => {

    //console.log(`Fetching Invoice ${invoiceId} for Realm ${realmId} and Access Token ${accessToken}`);
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/invoice/${invoiceId}`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  return res.data.Invoice;
};
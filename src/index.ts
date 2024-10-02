import { startManagementAPI } from './managementAPI';
import { startReverseProxy } from './reverseProxy';

// Start the APIs
startManagementAPI();
startReverseProxy();

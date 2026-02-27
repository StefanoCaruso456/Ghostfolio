import { Injectable } from '@angular/core';

declare global {
  interface Window {
    Plaid?: {
      create: (config: PlaidCreateConfig) => PlaidHandler;
    };
  }
}

interface PlaidCreateConfig {
  token: string;
  onSuccess: (publicToken: string, metadata: any) => void;
  onExit: (err: any, metadata: any) => void;
  onEvent?: (eventName: string, metadata: any) => void;
}

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

@Injectable({ providedIn: 'root' })
export class PlaidLinkService {
  private scriptLoaded = false;

  /**
   * Dynamically loads the Plaid Link SDK and opens the Link flow.
   * Returns a promise that resolves with the public token + metadata on success,
   * or rejects if the user exits or an error occurs.
   */
  public async open(
    linkToken: string
  ): Promise<{ publicToken: string; metadata: any }> {
    await this.loadScript();

    return new Promise((resolve, reject) => {
      const handler = window.Plaid.create({
        onEvent: () => {
          // Optional: can be used for analytics
        },
        onExit: (err) => {
          handler.destroy();

          if (err) {
            reject(err);
          } else {
            reject(new Error('User exited Plaid Link'));
          }
        },
        onSuccess: (publicToken, metadata) => {
          handler.destroy();
          resolve({ metadata, publicToken });
        },
        token: linkToken
      });

      handler.open();
    });
  }

  private loadScript(): Promise<void> {
    if (this.scriptLoaded && window.Plaid) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.async = true;

      script.onload = () => {
        this.scriptLoaded = true;
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Plaid Link SDK'));
      };

      document.head.appendChild(script);
    });
  }
}

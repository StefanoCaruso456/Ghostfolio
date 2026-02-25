import {
  KEY_STAY_SIGNED_IN,
  SettingsStorageService
} from '@ghostfolio/client/services/settings-storage.service';
import { GfDialogHeaderComponent } from '@ghostfolio/ui/dialog-header';

import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatCheckboxChange,
  MatCheckboxModule
} from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkOutline,
  copyOutline,
  eyeOffOutline,
  eyeOutline
} from 'ionicons/icons';

import { LoginWithAccessTokenDialogParams } from './interfaces/interfaces';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GfDialogHeaderComponent,
    IonIcon,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  selector: 'gf-login-with-access-token-dialog',
  styleUrls: ['./login-with-access-token-dialog.scss'],
  templateUrl: './login-with-access-token-dialog.html'
})
export class GfLoginWithAccessTokenDialogComponent {
  public accessTokenFormControl = new FormControl(
    this.data.accessToken,
    Validators.required
  );
  public demoToken =
    'e5b84a5d455d675334e512d02c7f5e3bed2946ae8d7ee7cf16d375c9d019da265b5080f8f1be47c6cc12722bd019085dcfb8fe8a78889be88ba71284887d4453';
  public isAccessTokenHidden = true;
  public isTokenCopied = false;

  public constructor(
    @Inject(MAT_DIALOG_DATA) public data: LoginWithAccessTokenDialogParams,
    public dialogRef: MatDialogRef<GfLoginWithAccessTokenDialogComponent>,
    private settingsStorageService: SettingsStorageService
  ) {
    addIcons({ checkmarkOutline, copyOutline, eyeOffOutline, eyeOutline });
  }

  public onChangeStaySignedIn(aValue: MatCheckboxChange) {
    this.settingsStorageService.setSetting(
      KEY_STAY_SIGNED_IN,
      aValue.checked?.toString()
    );
  }

  public onClose() {
    this.dialogRef.close();
  }

  public onCopyToken() {
    navigator.clipboard.writeText(this.demoToken);
    this.isTokenCopied = true;

    setTimeout(() => {
      this.isTokenCopied = false;
    }, 2000);
  }

  public onLoginWithAccessToken() {
    if (this.accessTokenFormControl.valid) {
      this.dialogRef.close({
        accessToken: this.accessTokenFormControl.value
      });
    }
  }
}

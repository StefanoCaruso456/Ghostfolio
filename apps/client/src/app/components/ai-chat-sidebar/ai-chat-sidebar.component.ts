import { UserService } from '@ghostfolio/client/services/user/user.service';
import { User } from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowUpOutline,
  attachOutline,
  chatbubbleEllipsesOutline,
  checkmarkOutline,
  chevronDownOutline,
  closeOutline,
  copyOutline,
  createOutline,
  documentTextOutline,
  refreshOutline,
  sparklesOutline,
  stopCircleOutline,
  trashOutline
} from 'ionicons/icons';
import { MarkdownModule } from 'ngx-markdown';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface Attachment {
  data: string; // base64 data
  name: string;
  previewUrl: string;
  type: 'csv' | 'image';
}

interface ChatMessage {
  attachments?: Attachment[];
  content: string;
  isCopied?: boolean;
  isError?: boolean;
  isLoading?: boolean;
  role: 'assistant' | 'user';
  timestamp: string;
}

interface Conversation {
  id: string;
  messages: ChatMessage[];
  title: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    MarkdownModule,
    MatButtonModule,
    MatTooltipModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-ai-chat-sidebar',
  styleUrls: ['./ai-chat-sidebar.component.scss'],
  templateUrl: './ai-chat-sidebar.component.html'
})
export class GfAiChatSidebarComponent implements OnDestroy, OnInit {
  @Input() user: User;

  @Output() closed = new EventEmitter<void>();

  @ViewChild('chatInput') chatInputElement: ElementRef<HTMLTextAreaElement>;
  @ViewChild('messagesContainer')
  messagesContainerElement: ElementRef<HTMLDivElement>;

  public attachments: Attachment[] = [];
  public conversations: Conversation[] = [];
  public currentConversation: Conversation | null = null;
  public inputValue = '';
  public isGenerating = false;
  public showHistory = false;

  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  private static readonly ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ];

  public readonly suggestedPrompts = [
    {
      icon: 'sparkles-outline',
      label: $localize`Analyze my portfolio`,
      prompt: 'Analyze my current portfolio allocation, risks, and strengths.'
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Diversification check`,
      prompt:
        'How well diversified is my portfolio? What areas could I improve?'
    },
    {
      icon: 'sparkles-outline',
      label: $localize`Risk assessment`,
      prompt:
        'What are the main risks in my current portfolio and how can I mitigate them?'
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Sector breakdown`,
      prompt:
        'Break down my portfolio by sector and asset class. Are there any imbalances?'
    }
  ];

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private userService: UserService
  ) {
    addIcons({
      arrowUpOutline,
      attachOutline,
      chatbubbleEllipsesOutline,
      checkmarkOutline,
      chevronDownOutline,
      closeOutline,
      copyOutline,
      createOutline,
      documentTextOutline,
      refreshOutline,
      sparklesOutline,
      stopCircleOutline,
      trashOutline
    });
  }

  public ngOnInit() {
    this.loadConversations();

    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        this.user = state.user;
        this.changeDetectorRef.markForCheck();
      });
  }

  public onClose() {
    this.closed.emit();
  }

  public onNewConversation() {
    this.attachments = [];
    this.currentConversation = null;
    this.inputValue = '';
    this.showHistory = false;
    this.changeDetectorRef.markForCheck();
    this.focusInput();
  }

  public onSelectConversation(conversation: Conversation) {
    this.currentConversation = conversation;
    this.showHistory = false;
    this.changeDetectorRef.markForCheck();
    this.scrollToBottom();
  }

  public onDeleteConversation(event: Event, conversation: Conversation) {
    event.stopPropagation();
    this.conversations = this.conversations.filter(
      (c) => c.id !== conversation.id
    );

    if (this.currentConversation?.id === conversation.id) {
      this.currentConversation = null;
    }

    this.saveConversations();
    this.changeDetectorRef.markForCheck();
  }

  public onToggleHistory() {
    this.showHistory = !this.showHistory;
    this.changeDetectorRef.markForCheck();
  }

  public onUseSuggestedPrompt(prompt: string) {
    this.inputValue = prompt;
    this.onSendMessage();
  }

  public onSendMessage() {
    const message = this.inputValue.trim();
    const hasAttachments = this.attachments.length > 0;

    if ((!message && !hasAttachments) || this.isGenerating) {
      return;
    }

    const currentAttachments = [...this.attachments];

    this.inputValue = '';
    this.attachments = [];

    if (!this.currentConversation) {
      const title = message || `${currentAttachments.length} file(s) attached`;
      this.currentConversation = {
        id: crypto.randomUUID(),
        messages: [],
        title: title.slice(0, 50) + (title.length > 50 ? '...' : '')
      };
      this.conversations.unshift(this.currentConversation);
    }

    const userMessage: ChatMessage = {
      attachments:
        currentAttachments.length > 0 ? currentAttachments : undefined,
      content: message,
      role: 'user',
      timestamp: new Date().toISOString()
    };
    this.currentConversation.messages.push(userMessage);

    const loadingMessage: ChatMessage = {
      content: '',
      isLoading: true,
      role: 'assistant',
      timestamp: new Date().toISOString()
    };
    this.currentConversation.messages.push(loadingMessage);

    this.isGenerating = true;
    this.changeDetectorRef.markForCheck();
    this.scrollToBottom();

    const history = this.currentConversation.messages
      .filter((m) => !m.isLoading && !m.isError)
      .slice(0, -1)
      .map((m) => ({ content: m.content, role: m.role }));

    this.dataService
      .chatWithAi({
        history,
        message,
        conversationId: this.currentConversation.id
      })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        error: () => {
          const lastMessage =
            this.currentConversation.messages[
              this.currentConversation.messages.length - 1
            ];
          lastMessage.content = $localize`Sorry, I encountered an error. Please try again.`;
          lastMessage.isError = true;
          lastMessage.isLoading = false;

          this.isGenerating = false;
          this.saveConversations();
          this.changeDetectorRef.markForCheck();
        },
        next: (response) => {
          const lastMessage =
            this.currentConversation.messages[
              this.currentConversation.messages.length - 1
            ];
          lastMessage.content = response.message.content;
          lastMessage.isLoading = false;
          lastMessage.timestamp = response.message.timestamp;

          this.isGenerating = false;
          this.saveConversations();
          this.changeDetectorRef.markForCheck();
          this.scrollToBottom();
        }
      });
  }

  public onCopyMessage(message: ChatMessage) {
    navigator.clipboard.writeText(message.content).then(() => {
      message.isCopied = true;
      this.changeDetectorRef.markForCheck();

      setTimeout(() => {
        message.isCopied = false;
        this.changeDetectorRef.markForCheck();
      }, 2000);
    });
  }

  public onRetryMessage(messageIndex: number) {
    if (!this.currentConversation || this.isGenerating) {
      return;
    }

    // Remove the failed assistant message and the user message before it
    this.currentConversation.messages.splice(messageIndex - 1, 2);
    this.changeDetectorRef.markForCheck();

    // Resend the last user message
    const lastUserMessage = [...this.currentConversation.messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (lastUserMessage) {
      this.inputValue = lastUserMessage.content;
    }
  }

  public onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files) {
      return;
    }

    for (const file of Array.from(files)) {
      if (file.size > GfAiChatSidebarComponent.MAX_FILE_SIZE) {
        continue;
      }

      const isImage = GfAiChatSidebarComponent.ALLOWED_IMAGE_TYPES.includes(
        file.type
      );
      const isCsv =
        file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');

      if (!isImage && !isCsv) {
        continue;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const base64 = reader.result as string;
        const attachment: Attachment = {
          data: base64,
          name: file.name,
          previewUrl: isImage ? base64 : '',
          type: isImage ? 'image' : 'csv'
        };

        this.attachments.push(attachment);
        this.changeDetectorRef.markForCheck();
      };

      reader.readAsDataURL(file);
    }

    // Reset so the same file can be re-selected
    input.value = '';
  }

  public onRemoveAttachment(attachment: Attachment) {
    this.attachments = this.attachments.filter((a) => a !== attachment);
    this.changeDetectorRef.markForCheck();
  }

  public onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  public adjustTextareaHeight(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }

  public trackByIndex(index: number) {
    return index;
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private focusInput() {
    setTimeout(() => {
      this.chatInputElement?.nativeElement?.focus();
    });
  }

  private loadConversations() {
    try {
      const stored = localStorage.getItem('gf-ai-conversations');

      if (stored) {
        this.conversations = JSON.parse(stored);
      }
    } catch {
      this.conversations = [];
    }
  }

  private saveConversations() {
    try {
      const toSave = this.conversations.map((c) => ({
        ...c,
        messages: c.messages.filter((m) => !m.isLoading)
      }));
      localStorage.setItem('gf-ai-conversations', JSON.stringify(toSave));
    } catch {
      // Storage full or unavailable
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const container = this.messagesContainerElement?.nativeElement;

      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }
}

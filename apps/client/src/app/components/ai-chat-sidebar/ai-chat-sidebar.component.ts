import { GfReasoningPanelComponent } from '@ghostfolio/client/components/reasoning-panel/reasoning-panel.component';
import { AiSidebarService } from '@ghostfolio/client/services/ai-sidebar.service';
import { ReasoningTraceService } from '@ghostfolio/client/services/reasoning-trace.service';
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
  bulbOutline,
  chatbubbleEllipsesOutline,
  checkmarkOutline,
  chevronBackOutline,
  chevronDownOutline,
  closeOutline,
  cloudUploadOutline,
  copyOutline,
  createOutline,
  documentTextOutline,
  expandOutline,
  menuOutline,
  micOffOutline,
  micOutline,
  pencilOutline,
  refreshOutline,
  sparklesOutline,
  stopCircleOutline,
  trashOutline
} from 'ionicons/icons';
import { MarkdownModule } from 'ngx-markdown';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface Attachment {
  content: string; // base64 data URL for images, raw text for CSVs
  mimeType: string; // actual MIME type (e.g. 'image/png', 'text/csv')
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

interface ToolEntry {
  description: string;
  name: string;
  prompt: string;
}

interface ToolCategory {
  icon: string;
  label: string;
  tools: ToolEntry[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    GfReasoningPanelComponent,
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
  @Input() mode: 'sidebar' | 'fullscreen' = 'sidebar';
  @Input() user: User;

  @Output() closed = new EventEmitter<void>();
  @Output() expandClicked = new EventEmitter<void>();

  @ViewChild('chatInput') chatInputElement: ElementRef<HTMLTextAreaElement>;
  @ViewChild('messagesContainer')
  messagesContainerElement: ElementRef<HTMLDivElement>;

  public attachments: Attachment[] = [];
  public conversations: Conversation[] = [];
  public currentConversation: Conversation | null = null;
  public currentTraceId: string | null = null;
  public editingConversationId: string | null = null;
  public editingTitle = '';
  public inputValue = '';
  public isDragging = false;
  public isGenerating = false;
  public isRecording = false;
  public isSpeechSupported = false;
  public showHistory = false;
  public showToolDiscovery = false;

  private dragCounter = 0;
  private speechRecognition: any = null;

  private static readonly ALLOWED_IMAGE_TYPES = [
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ];
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

  public readonly toolCatalog: ToolCategory[] = [
    {
      icon: 'sparkles-outline',
      label: $localize`Portfolio Analysis`,
      tools: [
        {
          description: 'Holdings overview, top positions, accounts',
          name: 'getPortfolioSummary',
          prompt:
            'Give me a summary of my portfolio including top holdings and account breakdown.'
        },
        {
          description: 'Deep-dive on a specific holding',
          name: 'getHoldingDetail',
          prompt:
            'Show me detailed information for my largest holding including performance, dividends, and fees.'
        },
        {
          description: 'Portfolio value chart over time',
          name: 'getPortfolioChart',
          prompt:
            'Show my portfolio performance chart for the last 12 months with peak and trough analysis.'
        },
        {
          description: 'Allocation by asset class, sector, currency',
          name: 'getAllocations',
          prompt:
            'Break down my portfolio allocations by asset class, sector, and currency.'
        },
        {
          description: 'Dividend income breakdown',
          name: 'getDividendSummary',
          prompt:
            'Summarize my dividend income with a breakdown by symbol and period.'
        },
        {
          description: 'Portfolio transactions and trades',
          name: 'listActivities',
          prompt:
            'List my recent portfolio transactions including trades, dividends, and fees.'
        }
      ]
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Market Data`,
      tools: [
        {
          description: 'Real-time price quotes',
          name: 'getQuote',
          prompt: 'Get me the current quotes for AAPL, MSFT, and GOOGL.'
        },
        {
          description: 'Historical price data with analytics',
          name: 'getHistory',
          prompt:
            'Show me the price history of AAPL for the last 6 months with volatility and drawdown metrics.'
        },
        {
          description: 'Valuation metrics (P/E, EPS, market cap)',
          name: 'getFundamentals',
          prompt:
            'What are the fundamental valuation metrics for NVDA including P/E, EPS, and dividend yield?'
        },
        {
          description: 'Recent news and articles',
          name: 'getNews',
          prompt: 'What is the latest news on TSLA?'
        },
        {
          description: 'Portfolio returns and net worth',
          name: 'getPerformance',
          prompt:
            'Show my portfolio performance metrics including total returns, net worth, and total investment.'
        }
      ]
    },
    {
      icon: 'sparkles-outline',
      label: $localize`Decision Support`,
      tools: [
        {
          description: 'Compare current vs target allocation',
          name: 'computeRebalance',
          prompt:
            'Rebalance my portfolio to a target of 60% stocks, 30% bonds, and 10% cash. Show the deltas.'
        },
        {
          description: 'What-if scenario analysis',
          name: 'scenarioImpact',
          prompt:
            'What if the market drops 20%? Simulate the impact on my portfolio.'
        }
      ]
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Tax Intelligence`,
      tools: [
        {
          description: 'Connected brokerage and bank accounts',
          name: 'listConnectedAccounts',
          prompt: 'List all my connected brokerage and bank accounts.'
        },
        {
          description: 'Trigger sync for a connected account',
          name: 'syncAccount',
          prompt: 'Sync my connected brokerage account to pull the latest data.'
        },
        {
          description: 'Holdings with cost basis and unrealized gains',
          name: 'getTaxHoldings',
          prompt:
            'Show my cross-account holdings with cost basis and unrealized gain/loss for tax purposes.'
        },
        {
          description: 'Tax-relevant transaction history',
          name: 'getTaxTransactions',
          prompt: 'Show my tax-relevant transactions from this year.'
        },
        {
          description: 'FIFO-derived tax lots',
          name: 'getTaxLots',
          prompt:
            'Show my tax lots with holding periods and short-term vs long-term classification.'
        },
        {
          description: 'Simulate selling shares with tax impact',
          name: 'simulateSale',
          prompt:
            'Simulate selling 50 shares of my largest holding and show the estimated tax impact including federal, state, and NIIT.'
        },
        {
          description: 'Liquidate all holdings tax estimate',
          name: 'portfolioLiquidation',
          prompt:
            'Simulate liquidating my entire portfolio and show the total tax liability breakdown.'
        },
        {
          description: 'Find tax-loss harvesting candidates',
          name: 'taxLossHarvest',
          prompt:
            'Find tax-loss harvesting opportunities in my portfolio and flag any wash sale risks.'
        },
        {
          description: 'Detect IRS wash sale violations',
          name: 'washSaleCheck',
          prompt:
            'Check my recent trades for any potential IRS wash sale violations within the 30-day window.'
        },
        {
          description: 'Create cost basis correction',
          name: 'createAdjustment',
          prompt:
            'Help me create a cost basis adjustment for a position that has an incorrect cost basis.'
        },
        {
          description: 'Modify existing adjustment',
          name: 'updateAdjustment',
          prompt:
            'Show my existing cost basis adjustments and help me update one.'
        },
        {
          description: 'Remove cost basis adjustment',
          name: 'deleteAdjustment',
          prompt:
            'List my cost basis adjustments and help me remove one that is no longer needed.'
        }
      ]
    },
    {
      icon: 'chatbubble-ellipses-outline',
      label: $localize`Web Search`,
      tools: [
        {
          description: 'Real-time web search for news and analysis',
          name: 'webSearch',
          prompt:
            'Search the web for the latest Federal Reserve interest rate decisions and summarize the market impact.'
        }
      ]
    }
  ];

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private aiSidebarService: AiSidebarService,
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private reasoningTraceService: ReasoningTraceService,
    private userService: UserService
  ) {
    addIcons({
      arrowUpOutline,
      attachOutline,
      bulbOutline,
      chatbubbleEllipsesOutline,
      checkmarkOutline,
      chevronBackOutline,
      chevronDownOutline,
      closeOutline,
      cloudUploadOutline,
      copyOutline,
      createOutline,
      documentTextOutline,
      expandOutline,
      menuOutline,
      micOffOutline,
      micOutline,
      pencilOutline,
      refreshOutline,
      sparklesOutline,
      stopCircleOutline,
      trashOutline
    });
  }

  public ngOnInit() {
    // In fullscreen mode, always show history sidebar
    if (this.mode === 'fullscreen') {
      this.showHistory = true;
    }

    this.loadConversations();
    this.initSpeechRecognition();

    this.aiSidebarService.prompt$
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe(({ message, autoSend }) => {
        this.onNewConversation();
        this.inputValue = message;
        this.changeDetectorRef.markForCheck();

        if (autoSend) {
          setTimeout(() => {
            this.onSendMessage('news_channel');
          }, 150);
        }
      });

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

  public onExpand() {
    this.expandClicked.emit();
  }

  public onNewConversation() {
    this.currentConversation = null;
    this.currentTraceId = null;
    this.inputValue = '';
    this.attachments = [];

    // Only hide history in sidebar mode; keep it open in fullscreen
    if (this.mode === 'sidebar') {
      this.showHistory = false;
    }

    this.reasoningTraceService.reset();
    this.changeDetectorRef.markForCheck();
    this.focusInput();
  }

  public onSelectConversation(conversation: Conversation) {
    this.currentConversation = conversation;

    // Only hide history in sidebar mode; keep it open in fullscreen
    if (this.mode === 'sidebar') {
      this.showHistory = false;
    }

    this.changeDetectorRef.markForCheck();

    // Load messages from API if not already loaded
    if (conversation.messages.length === 0) {
      this.dataService
        .getAiConversation(conversation.id)
        .pipe(takeUntil(this.unsubscribeSubject))
        .subscribe({
          error: () => {
            // Messages may already be in localStorage cache
          },
          next: (fullConversation) => {
            if (fullConversation?.messages) {
              conversation.messages = fullConversation.messages.map((m) => ({
                content: m.content,
                role: m.role as 'assistant' | 'user',
                timestamp: m.createdAt
              }));
              this.changeDetectorRef.markForCheck();
              this.scrollToBottom();
            }
          }
        });
    } else {
      this.scrollToBottom();
    }
  }

  public onDeleteConversation(event: Event, conversation: Conversation) {
    event.stopPropagation();

    // Optimistic UI update
    this.conversations = this.conversations.filter(
      (c) => c.id !== conversation.id
    );

    if (this.currentConversation?.id === conversation.id) {
      this.currentConversation = null;
    }

    this.saveConversations();
    this.changeDetectorRef.markForCheck();

    // API delete (non-blocking)
    this.dataService
      .deleteAiConversation(conversation.id)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe();
  }

  public onStartRename(event: Event, conversation: Conversation) {
    event.stopPropagation();
    this.editingConversationId = conversation.id;
    this.editingTitle = conversation.title;
    this.changeDetectorRef.markForCheck();
  }

  public onFinishRename(conversation: Conversation) {
    const newTitle = this.editingTitle.trim();

    if (newTitle && newTitle !== conversation.title) {
      conversation.title = newTitle;
      this.saveConversations();

      // API update (non-blocking)
      this.dataService
        .updateAiConversation(conversation.id, { title: newTitle })
        .pipe(takeUntil(this.unsubscribeSubject))
        .subscribe();
    }

    this.editingConversationId = null;
    this.changeDetectorRef.markForCheck();
  }

  public onCancelRename() {
    this.editingConversationId = null;
    this.changeDetectorRef.markForCheck();
  }

  public onRenameKeydown(event: KeyboardEvent, conversation: Conversation) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onFinishRename(conversation);
    } else if (event.key === 'Escape') {
      this.onCancelRename();
    }
  }

  public onToggleHistory() {
    this.showHistory = !this.showHistory;
    this.changeDetectorRef.markForCheck();
  }

  public onToggleToolDiscovery() {
    this.showToolDiscovery = !this.showToolDiscovery;
    this.changeDetectorRef.markForCheck();
  }

  public onSelectToolPrompt(toolName: string, prompt: string) {
    this.showToolDiscovery = false;
    this.inputValue = prompt;
    this.onSendMessage(`tool_discovery:${toolName}`);
  }

  public onUseSuggestedPrompt(prompt: string) {
    this.inputValue = prompt;
    this.onSendMessage('suggested_prompt');
  }

  public onSendMessage(triggerSource: string = 'manual') {
    const message = this.inputValue.trim();
    const hasAttachments = this.attachments.length > 0;

    if ((!message && !hasAttachments) || this.isGenerating) {
      return;
    }

    // Capture and clear attachments + input
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

    // Generate traceId upfront so we can connect SSE immediately
    const traceId = crypto.randomUUID();
    this.currentTraceId = traceId;
    this.reasoningTraceService.connect(traceId);

    this.changeDetectorRef.markForCheck();
    this.scrollToBottom();
    this.focusInput();

    const history = this.currentConversation.messages
      .filter((m) => !m.isLoading && !m.isError)
      .slice(0, -1)
      .map((m) => ({ content: m.content, role: m.role }));

    this.dataService
      .chatWithAi({
        attachments: currentAttachments.length
          ? currentAttachments.map((a) => ({
              content: a.content,
              fileName: a.name,
              mimeType: a.mimeType,
              size: a.content.length
            }))
          : undefined,
        history,
        message,
        conversationId: this.currentConversation.id,
        traceId,
        triggerSource
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
          this.focusInput();
        },
        next: (response) => {
          const lastMessage =
            this.currentConversation.messages[
              this.currentConversation.messages.length - 1
            ];
          lastMessage.content = response.message.content;
          lastMessage.isLoading = false;
          lastMessage.timestamp = response.message.timestamp;

          // Fallback: if SSE didn't deliver steps, load persisted trace
          if (response.traceId) {
            this.currentTraceId = response.traceId;

            this.reasoningTraceService
              .getTrace(response.traceId)
              .pipe(takeUntil(this.unsubscribeSubject))
              .subscribe({
                error: () => {
                  // Trace may not be persisted yet
                },
                next: () => {
                  this.changeDetectorRef.markForCheck();
                }
              });
          }

          this.isGenerating = false;
          this.saveConversations();
          this.changeDetectorRef.markForCheck();
          this.scrollToBottom();
          this.focusInput();
        }
      });
  }

  public onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;

    if (input.files) {
      this.processFiles(input.files);
    }

    // Reset so the same file can be re-selected
    input.value = '';
  }

  public onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  public onDragEnter(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;

    if (this.dragCounter === 1) {
      this.isDragging = true;
      this.changeDetectorRef.markForCheck();
    }
  }

  public onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;

    if (this.dragCounter === 0) {
      this.isDragging = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  public onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragging = false;

    if (event.dataTransfer?.files?.length) {
      this.processFiles(event.dataTransfer.files);
    }

    this.changeDetectorRef.markForCheck();
  }

  public onRemoveAttachment(attachment: Attachment) {
    this.attachments = this.attachments.filter((a) => a !== attachment);
    this.changeDetectorRef.markForCheck();
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

  public onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  public onToggleVoiceInput(): void {
    if (!this.speechRecognition) {
      return;
    }

    if (this.isRecording) {
      this.speechRecognition.stop();
      this.isRecording = false;
    } else {
      this.speechRecognition.start();
      this.isRecording = true;
    }

    this.changeDetectorRef.markForCheck();
  }

  public adjustTextareaHeight(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }

  public trackByIndex(index: number) {
    return index;
  }

  public isLastAssistantMessage(index: number): boolean {
    if (!this.currentConversation) {
      return false;
    }

    const messages = this.currentConversation.messages;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return i === index;
      }
    }

    return false;
  }

  public ngOnDestroy() {
    if (this.speechRecognition && this.isRecording) {
      this.speechRecognition.stop();
    }

    this.reasoningTraceService.reset();
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  private initSpeechRecognition(): void {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      this.isSpeechSupported = false;

      return;
    }

    this.isSpeechSupported = true;
    this.speechRecognition = new SpeechRecognitionCtor();
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang = this.user?.settings?.language ?? 'en-US';

    this.speechRecognition.onresult = (event: any) => {
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        this.inputValue +=
          (this.inputValue ? ' ' : '') + finalTranscript.trim();
        this.changeDetectorRef.markForCheck();
      }
    };

    this.speechRecognition.onend = () => {
      this.isRecording = false;
      this.changeDetectorRef.markForCheck();
    };

    this.speechRecognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      this.isRecording = false;
      this.changeDetectorRef.markForCheck();
    };
  }

  private processFiles(files: FileList) {
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

      if (isImage) {
        const reader = new FileReader();

        reader.onload = () => {
          const dataUrl = reader.result as string;

          this.attachments.push({
            content: dataUrl,
            mimeType: file.type,
            name: file.name,
            previewUrl: dataUrl,
            type: 'image'
          });
          this.changeDetectorRef.markForCheck();
        };

        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();

        reader.onload = () => {
          const text = reader.result as string;

          this.attachments.push({
            content: text,
            mimeType: 'text/csv',
            name: file.name,
            previewUrl: '',
            type: 'csv'
          });
          this.changeDetectorRef.markForCheck();
        };

        reader.readAsText(file);
      }
    }
  }

  private focusInput() {
    setTimeout(() => {
      this.chatInputElement?.nativeElement?.focus();
    });
  }

  private loadConversations() {
    // Always load from localStorage first so we have data immediately
    let localConversations: Conversation[] = [];

    try {
      const stored = localStorage.getItem('gf-ai-conversations');

      if (stored) {
        localConversations = JSON.parse(stored);
      }
    } catch {
      localConversations = [];
    }

    this.conversations = localConversations;
    this.autoSelectRecentConversation();
    this.changeDetectorRef.markForCheck();

    // Then try API to merge in any server-side conversations
    this.dataService
      .getAiConversations()
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        error: () => {
          // Already loaded from localStorage above — nothing to do
        },
        next: (apiConversations) => {
          if (apiConversations.length === 0) {
            // API returned empty — keep localStorage data as-is
            return;
          }

          // Merge: API conversations take priority, local-only ones are preserved
          const apiIds = new Set(apiConversations.map((c) => c.id));
          const localOnly = this.conversations.filter((c) => !apiIds.has(c.id));
          const merged = [
            ...apiConversations.map((c) => {
              // Preserve locally-cached messages if available
              const local = this.conversations.find((lc) => lc.id === c.id);

              return {
                id: c.id,
                messages: local?.messages ?? [],
                title: c.title
              };
            }),
            ...localOnly
          ];

          this.conversations = merged;
          this.saveConversations();
          this.autoSelectRecentConversation();
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private autoSelectRecentConversation() {
    // In fullscreen mode, auto-select the most recent conversation
    if (
      this.mode === 'fullscreen' &&
      this.conversations.length > 0 &&
      !this.currentConversation
    ) {
      this.onSelectConversation(this.conversations[0]);
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

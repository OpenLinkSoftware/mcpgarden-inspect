import { useState, useRef, useEffect } from 'react';
import { TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Loader2 } from 'lucide-react';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListToolsResultSchema, CompatibilityCallToolResultSchema, ClientRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ConnectionStatus } from "@/lib/constants";

// Create provider instance once outside the handler
const googleAI = new GoogleGenerativeAI(import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY);

// Define message types
type MessageRole = 'user' | 'assistant';
interface Message {
    role: MessageRole;
    content: string;
}

// Types for Gemini API
interface ModelConfig {
    temperature: number;
}

interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
    rawResult?: unknown;
}

// Define custom tool types to match Gemini's expectations
interface ToolParameters {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
}

interface GeminiTool {
    name: string;
    description: string;
    parameters: ToolParameters;
}

interface GenerationRequest {
    contents: {
        role: string;
        parts: { text: string }[];
    }[];
    generationConfig: ModelConfig;
    tools?: {
        functionDeclarations: GeminiTool[];
    }[];
}

interface ChatTabProps {
    mcpClient: Client | null;
    makeRequest: <T extends z.ZodType>(
        request: ClientRequest,
        schema: T,
        options?: {
            signal?: AbortSignal;
            suppressToast?: boolean;
            resetTimeoutOnProgress?: boolean;
            timeout?: number;
            maxTotalTimeout?: number;
        }
    ) => Promise<z.output<T>>;
    connectionStatus: ConnectionStatus;
}

// Add type for schema properties
interface SchemaProperty {
    type?: string;
    description?: string;
    [key: string]: unknown;
}

interface InputSchema {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    [key: string]: unknown;
}

// Add type for Gemini property schema
interface GeminiProperty {
    type: string;
    description: string;
}

const ChatTab = ({ mcpClient, makeRequest, connectionStatus }: ChatTabProps) => {
    // State for messages in the chat
    const [messages, setMessages] = useState<Message[]>([]);
    // State for the user's current input
    const [input, setInput] = useState('');
    // State to track if the AI is currently generating a response
    const [isLoading, setIsLoading] = useState(false);
    // Ref for the end of the messages list to enable auto-scrolling
    const messagesEndRef = useRef<HTMLDivElement>(null);
    // State for tools with custom type
    const [tools, setTools] = useState<GeminiTool[]>([]);
    // State for tools loading
    const [toolsLoaded, setToolsLoaded] = useState(false);
    // State for debugging info
    const [debugInfo, setDebugInfo] = useState<string>("");

    // Effect to load tools when mcpClient is connected
    useEffect(() => {
        const loadTools = async () => {
            if (connectionStatus === "connected" && mcpClient && !toolsLoaded) {
                try {
                    const toolsResult = await makeRequest(
                        { method: "tools/list" },
                        ListToolsResultSchema
                    );

                    console.log("MCP tools response:", toolsResult);

                    // Convert MCP tools to Google GenAI tool format
                    if (toolsResult?.tools?.length > 0) {
                        const geminiTools = toolsResult.tools.map(tool => {
                            // Create a properties object that follows Gemini's structure
                            const schemaProperties: Record<string, GeminiProperty> = {};

                            // Process input schema properties if available
                            const inputSchema = tool.inputSchema as InputSchema || {};
                            if (inputSchema && inputSchema.properties) {
                                // Convert each property to Gemini's expected format
                                Object.entries(inputSchema.properties).forEach(([propName, propSchema]) => {
                                    // Skip special properties
                                    if (["additionalProperties", "$schema"].includes(propName)) {
                                        return;
                                    }

                                    // Determine the property type
                                    let type = propSchema.type || "string";

                                    // Map types to Gemini's supported types (STRING, NUMBER, BOOLEAN, etc.)
                                    if (type === "string") type = "STRING";
                                    else if (type === "number" || type === "integer") type = "NUMBER";
                                    else if (type === "boolean") type = "BOOLEAN";
                                    else if (type === "array") type = "ARRAY";
                                    else if (type === "object") type = "OBJECT";
                                    else type = "STRING"; // Default to STRING

                                    // Create the property schema
                                    schemaProperties[propName] = {
                                        type,
                                        description: propSchema.description || `Parameter: ${propName}`
                                    };
                                });
                            }

                            return {
                                name: tool.name,
                                description: tool.description || `MCP tool: ${tool.name}`,
                                parameters: {
                                    type: "OBJECT",
                                    properties: schemaProperties,
                                    required: Array.isArray(inputSchema.required)
                                        ? inputSchema.required
                                        : []
                                }
                            };
                        });

                        setTools(geminiTools);
                        console.log("MCP tools prepared for Google GenAI:", geminiTools);
                        setDebugInfo(`Loaded ${geminiTools.length} tools: ${JSON.stringify(geminiTools, null, 2)}`);
                    }
                    setToolsLoaded(true);
                } catch (err) {
                    console.error("Error loading MCP tools:", err);
                    setDebugInfo(`Error loading tools: ${err}`);
                    setToolsLoaded(true); // Still mark as loaded so we don't keep retrying
                }
            }
        };

        loadTools();
    }, [connectionStatus, mcpClient, makeRequest, toolsLoaded]);

    // Effect to scroll to the bottom whenever messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Update input state as user types
    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setInput(event.target.value);
    };

    // Handle form submission (sending a message)
    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Prevent sending empty messages or sending while loading
        if (!input.trim() || isLoading) return;

        setDebugInfo(""); // Clear debug info for new request

        // Add user message to the chat history immediately for responsiveness
        const newUserMessage: Message = { role: 'user', content: input };
        const updatedMessages = [...messages, newUserMessage];
        setMessages(updatedMessages);

        setInput(''); // Clear input field
        setIsLoading(true); // Show loading indicator

        try {
            setDebugInfo(`Sending message to Gemini with ${tools.length} tools available`);

            // Format history for Google GenAI
            const formattedMessages = updatedMessages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));

            // Select model
            const model = googleAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
                systemInstruction: tools.length > 0 ?
                    "You can use tools to help answer the user's question. Use tools whenever they would be helpful." :
                    undefined
            });

            // Configure model request
            const modelConfig: ModelConfig = {
                temperature: 0.2
            };

            // Create request configuration with proper typing
            const requestConfig: GenerationRequest = {
                contents: formattedMessages,
                generationConfig: modelConfig
            };

            // Add tools if available - outside of generationConfig
            if (tools.length > 0) {
                requestConfig.tools = [{
                    functionDeclarations: tools
                }];
            }

            // Stream response
            setDebugInfo(prev => prev + "\nSending request to model...");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const streamingResponse = await model.generateContentStream(requestConfig as any);

            let assistantResponse = "";
            let assistantMessageAdded = false;

            setDebugInfo(prev => prev + "\nStreaming response...");
            // Stream the text
            for await (const chunk of streamingResponse.stream) {
                const chunkText = chunk.text();
                console.log("Chunk:", chunkText || "(empty)");

                if (chunkText) {
                    assistantResponse += chunkText;

                    if (!assistantMessageAdded) {
                        // Add initial message
                        setMessages(prev => [...prev, { role: 'assistant', content: assistantResponse }]);
                        assistantMessageAdded = true;
                    } else {
                        // Update existing message
                        setMessages(prev => {
                            const lastMessageIndex = prev.length - 1;
                            const updated = [...prev];
                            if (lastMessageIndex >= 0 && updated[lastMessageIndex].role === 'assistant') {
                                updated[lastMessageIndex] = {
                                    ...updated[lastMessageIndex],
                                    content: assistantResponse
                                };
                            }
                            return updated;
                        });
                    }
                }
            }

            // Get the full response to check for function calls
            const response = await streamingResponse.response;
            console.log("Full response:", response);
            setDebugInfo(prev => prev + "\nResponse received");

            // Handle function calls
            // Safely extract function calls with proper type handling
            const functionCalls: FunctionCall[] = [];

            // Check if candidates and parts exist before trying to process
            if (response.candidates && response.candidates.length > 0) {
                const candidate = response.candidates[0];
                if (candidate.content && candidate.content.parts) {
                    candidate.content.parts.forEach(part => {
                        if (part.functionCall) {
                            functionCalls.push({
                                name: part.functionCall.name,
                                // Cast the args object to Record<string, unknown>
                                args: part.functionCall.args as Record<string, unknown> || {}
                            });
                        }
                    });
                }
            }

            if (functionCalls.length > 0) {
                console.log("Function calls detected:", functionCalls);
                setDebugInfo(prev => prev + "\nFunction calls detected: " + JSON.stringify(functionCalls));

                // Process each function call
                for (const functionCall of functionCalls) {
                    const toolName = functionCall.name;
                    const toolArgs = functionCall.args || {};

                    setDebugInfo(prev => prev + `\nCalling tool ${toolName} with args: ${JSON.stringify(toolArgs)}`);

                    try {
                        // Call the MCP tool
                        const result = await makeRequest(
                            {
                                method: "tools/call",
                                params: {
                                    name: toolName,
                                    arguments: toolArgs,
                                    _meta: {
                                        progressToken: Date.now()
                                    }
                                }
                            },
                            CompatibilityCallToolResultSchema
                        );

                        // Enhanced logging for tool results
                        console.log("Tool call executed:", { toolName, args: toolArgs, result });
                        setDebugInfo(prev => prev + `\nTool result: ${JSON.stringify(result, null, 2)}`);

                        // Store the raw result for later use in follow-up
                        functionCall.rawResult = result;

                        // Format tool response as a collapsible element with properly styled code block but original dropdown color
                        const toolResponse = `<details class="mt-1">
<summary class="cursor-pointer py-1 px-2 bg-primary/80 text-muted-foreground rounded-t-md font-medium text-sm flex items-center">
  <span class="mr-2">▶</span> Tool Response (${toolName})
</summary>
<pre class="bg-card border border-border rounded-b-md p-3 m-0 overflow-auto text-xs"><code class="text-card-foreground">${JSON.stringify(result, null, 2)}</code></pre>
</details>`;

                        setMessages(prev => {
                            const lastIndex = prev.length - 1;
                            if (lastIndex >= 0 && prev[lastIndex].role === 'assistant') {
                                const updated = [...prev];
                                updated[lastIndex] = {
                                    ...updated[lastIndex],
                                    content: updated[lastIndex].content + toolResponse
                                };
                                return updated;
                            }
                            // If there's no assistant message yet (unlikely), add one
                            return [...prev, { role: 'assistant', content: toolResponse }];
                        });
                    } catch (error) {
                        console.error(`Error executing tool ${toolName}:`, error);
                        setDebugInfo(prev => prev + `\nError executing tool: ${error instanceof Error ? error.message : String(error)}`);

                        // Append error information to the assistant's response
                        const errorMsg = `\n\nError using tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
                        setMessages(prev => {
                            const lastIndex = prev.length - 1;
                            if (lastIndex >= 0 && prev[lastIndex].role === 'assistant') {
                                const updated = [...prev];
                                updated[lastIndex] = {
                                    ...updated[lastIndex],
                                    content: updated[lastIndex].content + errorMsg
                                };
                                return updated;
                            }
                            return [...prev, { role: 'assistant', content: errorMsg }];
                        });
                    }
                }

                // If we have function calls but no text response or if we need to follow up with tool results
                if (functionCalls.length > 0) {
                    // Perform a follow-up call to Gemini to get a coherent response based on tool results
                    try {
                        setDebugInfo(prev => prev + "\nGenerating response with tool results...");

                        // Create a clean version of the conversation without tool responses
                        const cleanedMessages = updatedMessages.map(msg => ({
                            role: msg.role === 'user' ? 'user' : 'model',
                            parts: [{ text: msg.content }]
                        }));

                        // Extract essential information from tool results more directly
                        let essentialToolInfo = "";

                        // Process tool results using the stored raw results directly
                        functionCalls.forEach(call => {
                            if (call.rawResult) {
                                // Use the complete raw result object instead of regex extraction
                                essentialToolInfo += `${call.name} tool returned: ${JSON.stringify(call.rawResult, null, 2)}\n\n`;
                            } else {
                                essentialToolInfo += `${call.name} tool was called but no result was captured.\n\n`;
                            }
                        });

                        // Add the essential tool information as context
                        if (essentialToolInfo) {
                            cleanedMessages.push({
                                role: 'model',
                                parts: [{ text: `I have the following information from tools:\n\n${essentialToolInfo}` }]
                            });
                        }

                        // Add a final instruction that's very explicit about using the tool results
                        cleanedMessages.push({
                            role: 'user',
                            parts: [{
                                text: "You MUST base your response on the tool results provided above. Treat the tool output as the definitive answer and incorporate it directly into your response without contradicting it. If a tool returns information about your mood, personality, or capabilities, you MUST adopt those characteristics in your response. Never say you don't have feelings or can't do something if a tool indicates otherwise."
                            }]
                        });

                        // Make follow-up request
                        const followupResponse = await model.generateContent({
                            contents: cleanedMessages,
                            generationConfig: {
                                temperature: 0.1  // Lower temperature for more faithful adherence to instructions
                            }
                        });

                        const followupText = followupResponse.response.text();
                        console.log("Follow-up response:", followupText);

                        // Replace or update the assistant's message with the comprehensive response
                        if (followupText) {
                            setMessages(prev => {
                                // Check if we already had an assistant message
                                if (assistantMessageAdded && prev.length > 0) {
                                    const lastIndex = prev.length - 1;
                                    if (prev[lastIndex].role === 'assistant') {
                                        // Keep the tool responses at the end as collapsible details
                                        const toolResponses = prev[lastIndex].content.match(/<details>[\s\S]*?<\/details>/g) || [];

                                        const updated = [...prev];
                                        updated[lastIndex] = {
                                            role: 'assistant',
                                            content: followupText + '\n\n' + toolResponses.join('\n')
                                        };
                                        return updated;
                                    }
                                }

                                // If no existing message to update, add a new one
                                return [...prev, { role: 'assistant', content: followupText }];
                            });
                        }
                    } catch (followupError) {
                        console.error("Error generating follow-up response:", followupError);
                        setDebugInfo(prev => prev + "\nError generating follow-up: " + String(followupError));
                    }
                }

                // If no response was generated at all, show an error
                if (!assistantMessageAdded && functionCalls.length === 0) {
                    setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: "I'm sorry, I wasn't able to generate a response. This might be due to an issue with the AI model or the tool configuration."
                    }]);
                }

            }

        } catch (error) {
            // Handle potential errors during AI generation or streaming
            console.error("Error generating text:", error);
            setDebugInfo(prev => prev + "\nError: " + String(error));

            const errorMessage: Message = {
                role: 'assistant',
                content: `Error generating response: ${error instanceof Error ? error.message : String(error)}`
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            // Hide loading indicator
            setIsLoading(false);
        }
    };

    // Determine connection status text
    const connectionStatusText = (() => {
        switch (connectionStatus) {
            case "connected":
                return "Connected";
            case "error":
                return "Connection Error";
            case "error-connecting-to-proxy":
                return "Proxy Connection Error";
            default:
                return "Disconnected";
        }
    })();

    return (
        // Use mt-4 for spacing like other tabs
        <TabsContent value="chat" className="mt-4">
            {/* Connection status */}
            <div className="mb-2 flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${connectionStatus === "connected" ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-xs text-muted-foreground">
                    MCP: {connectionStatusText} {connectionStatus === "connected" && tools.length > 0 ?
                        ` - ${tools.length} tools available` :
                        connectionStatus === "connected" ? " - No tools found" : ""}
                </span>
            </div>

            {/* API Key Status */}
            <div className="mb-2 flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-xs text-muted-foreground">
                    Gemini API Key: {import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY ? 'Configured' : 'Missing'}
                </span>
            </div>

            {/* Debug Info (only visible when there is debug content) */}
            {debugInfo && (
                <div className="mb-2 p-2 bg-black/5 rounded text-xs overflow-x-auto">
                    <details>
                        <summary className="cursor-pointer font-medium">Debug Info</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{debugInfo}</pre>
                    </details>
                </div>
            )}

            {/* Main container: Set fixed height, flex column, border */}
            <div className="flex flex-col border rounded overflow-hidden" style={{ height: '500px' }}>
                {/* Message display area: grow and scroll */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                        // Initial message if chat history is empty
                        <Alert className="bg-background">
                            <AlertTitle>Chat Ready</AlertTitle>
                            <AlertDescription>
                                Send a message using the input below to start chatting with the AI.
                                {connectionStatus === "connected" ?
                                    tools.length > 0 ?
                                        ` MCP tools available: ${tools.map(t => t.name).join(', ')}` :
                                        " MCP connected but no tools available." :
                                    " MCP not connected - using Gemini only."}
                            </AlertDescription>
                        </Alert>
                    ) : (
                        // Render message history
                        messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`p-3 rounded-lg max-w-[85%] ${msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground' // User message style
                                        : 'bg-muted text-muted-foreground' // AI message style
                                        }`}
                                >
                                    {/* Use <pre> for better formatting of potential code/markdown */}
                                    {/* Ensure content is a string before rendering, provide fallback */}
                                    <pre className="text-sm whitespace-pre-wrap font-sans text-left"
                                        dangerouslySetInnerHTML={{
                                            __html: typeof msg.content === 'string'
                                                ? msg.content
                                                : JSON.stringify(msg.content, null, 2)
                                        }}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                    {/* Loading indicator */}
                    {isLoading && (
                        <div className="flex justify-center items-center p-3 text-muted-foreground">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            AI is thinking...
                        </div>
                    )}
                    {/* Empty div at the end of messages to scroll to */}
                    <div ref={messagesEndRef} />
                </div>
                {/* Input form area: Prevent shrinking */}
                <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 border-t flex items-center gap-2 bg-background">
                    <Input
                        type="text"
                        placeholder="Send a message..."
                        value={input}
                        onChange={handleInputChange}
                        className="flex-1"
                        disabled={isLoading} // Disable input while loading
                        aria-label="Chat input"
                    />
                    <Button type="submit" disabled={isLoading || !input.trim()}>
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                    </Button>
                </form>
            </div>
        </TabsContent>
    );
};

export default ChatTab;

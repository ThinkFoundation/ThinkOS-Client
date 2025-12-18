import { useEditor, EditorContent as TiptapEditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface EditorContentProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
}

export function EditorContent({
  content,
  onChange,
  placeholder = "Start writing...",
  editable = true,
  className,
  onEditorReady,
}: EditorContentProps) {
  // Track when we're programmatically setting content (to suppress onUpdate)
  const isSettingContentRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: content || '', // Pass content directly - component remounts via key when switching notes
    editable,
    onUpdate: ({ editor }) => {
      // Don't propagate changes when we're programmatically setting content
      if (!isSettingContentRef.current) {
        onChange(editor.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[200px]",
      },
    },
  });

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Sync content when prop changes (handles both initial load and updates)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      isSettingContentRef.current = true;
      editor.commands.setContent(content || '');
      isSettingContentRef.current = false;
    }
  }, [content, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  return (
    <div className={cn("relative", className)}>
      <TiptapEditorContent editor={editor} />
    </div>
  );
}

export type { EditorContentProps };

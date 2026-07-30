import { useState } from 'react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AnalysisPlan } from '../types';
import { adjustPlanWithAI } from '../utils/plan-adjuster';
import { VoiceButton } from './VoiceButton';

interface Props {
  plan: AnalysisPlan;
  onApprove: (updatedPlan: AnalysisPlan) => void;
  onBack: () => void;
}

function SortableItem({ id, children, onDelete }: { id: string; children: React.ReactNode; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className="plan-item supported">
      <span {...attributes} {...listeners} style={{ cursor: 'grab', fontSize: '1.1rem' }}>⠿</span>
      <div style={{ flex: 1 }}>{children}</div>
      <button onClick={onDelete} className="btn btn-sm" style={{ background: '#FFEBEE', color: '#D32F2F', border: 'none' }}>✕</button>
    </li>
  );
}

function SortableSlide({ id, children, onDelete }: { id: string; children: React.ReactNode; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={{ ...style, padding: '0.6rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'white' }}>
      <span {...attributes} {...listeners} style={{ cursor: 'grab' }}>⠿</span>
      <span style={{ flex: 1, fontSize: '0.9rem' }}>{children}</span>
      <button onClick={onDelete} className="btn btn-sm" style={{ background: '#FFEBEE', color: '#D32F2F', border: 'none', padding: '0.2rem 0.5rem' }}>✕</button>
    </li>
  );
}

export function PlanStage({ plan: initialPlan, onApprove, onBack }: Props) {
  const [formulas, setFormulas] = useState(initialPlan.formulas);
  const [slides, setSlides] = useState(initialPlan.suggestedSlides);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string; text: string }[]>([]);
  const [isAdjusting, setIsAdjusting] = useState(false);

  const handleFormulaDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = formulas.findIndex(f => f.id === active.id);
      const newIdx = formulas.findIndex(f => f.id === over.id);
      setFormulas(arrayMove(formulas, oldIdx, newIdx));
    }
  };

  const handleSlideDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = slides.findIndex((_, i) => `slide-${i}` === active.id);
      const newIdx = slides.findIndex((_, i) => `slide-${i}` === over.id);
      setSlides(arrayMove(slides, oldIdx, newIdx));
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || isAdjusting) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setIsAdjusting(true);

    try {
      const result = await adjustPlanWithAI(formulas, slides, msg);
      if (result.ok) {
        if (result.formulas) setFormulas(result.formulas);
        if (result.slides) setSlides(result.slides);
        setChatHistory(prev => [...prev, { role: 'ai', text: `✅ ${result.explanation}` }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'ai', text: `⚠️ ${result.explanation}` }]);
      }
    } catch {
      setChatHistory(prev => [...prev, { role: 'ai', text: '⚠️ AI 暫時無法回應，請手動拖曳調整' }]);
    }
    setIsAdjusting(false);
  };

  const handleApprove = () => {
    onApprove({
      ...initialPlan,
      formulas,
      suggestedSlides: slides,
    });
  };

  return (
    <>
      {/* Formulas - draggable */}
      <div className="card">
        <h2>🧮 計算指標（可拖曳排序、刪除）</h2>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleFormulaDragEnd}>
          <SortableContext items={formulas.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <ul className="plan-list">
              {formulas.map((f, i) => (
                <SortableItem key={f.id} id={f.id} onDelete={() => setFormulas(prev => prev.filter(x => x.id !== f.id))}>
                  <strong>{f.name}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{f.definition}</div>
                </SortableItem>
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {/* Unsupported */}
        {initialPlan.unsupported.length > 0 && (
          <div style={{ marginTop: '0.8rem' }}>
            {initialPlan.unsupported.map((u, i) => (
              <div key={i} className="plan-item unsupported">
                <span className="badge badge-warning">⚠️</span>
                <div><strong>{u.name}</strong><div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>{u.reason}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slides - draggable */}
      <div className="card">
        <h2>🎨 簡報架構（{slides.length} 頁，可拖曳排序）</h2>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleSlideDragEnd}>
          <SortableContext items={slides.map((_, i) => `slide-${i}`)} strategy={verticalListSortingStrategy}>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {slides.map((s, i) => (
                <SortableSlide key={`slide-${i}`} id={`slide-${i}`} onDelete={() => setSlides(prev => prev.filter((_, idx) => idx !== i))}>
                  {i + 1}. {s}
                </SortableSlide>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {/* AI Chat */}
      <div className="card">
        <h2>💬 AI 對話調整</h2>
        {chatHistory.length > 0 && (
          <div style={{ marginBottom: '1rem', maxHeight: '200px', overflowY: 'auto' }}>
            {chatHistory.map((msg, i) => (
              <div key={i} style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600, color: msg.role === 'user' ? 'var(--primary)' : 'var(--info)' }}>
                  {msg.role === 'user' ? '你：' : 'AI：'}
                </span>
                <span style={{ fontSize: '0.9rem' }}>{msg.text}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="input"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="告訴 AI 你想怎麼調整，例如「加一頁競爭者比較」「移除月增率」..."
            onKeyDown={e => e.key === 'Enter' && handleChat()}
            disabled={isAdjusting}
          />
          <VoiceButton onResult={text => setChatInput(prev => prev + text)} />
          <button className="btn btn-primary btn-sm" onClick={handleChat} disabled={isAdjusting || !chatInput.trim()}>
            {isAdjusting ? '調整中...' : '送出'}
          </button>
        </div>
      </div>

      {/* Assumptions */}
      <div className="card">
        <h2>📐 假設條件</h2>
        <ul style={{ paddingLeft: '1.2rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
          {initialPlan.assumptions.map((a, i) => <li key={i} style={{ marginBottom: '0.3rem' }}>{a}</li>)}
        </ul>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
        <button className="btn btn-secondary" onClick={onBack}>← 返回修改</button>
        <button className="btn btn-primary btn-lg" onClick={handleApprove}>
          ✅ 確認計劃，開始生成簡報（{slides.length} 頁）
        </button>
      </div>
    </>
  );
}
